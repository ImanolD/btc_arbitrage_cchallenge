import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  EngineConfig,
  ExchangeId,
  LatencyStats,
  Opportunity,
  PortfolioStats,
  SimulatedTrade,
  TopOfBook,
} from "@arb/shared";
import { feeModels, startingBalances } from "../config.js";
import { OrderBookStore } from "../marketData/orderBookStore.js";
import { computeArbitrage, topOfBookArb } from "./profit.js";
import { RiskManager } from "./riskManager.js";
import { Portfolio } from "./portfolio.js";
import { ExecutionSimulator } from "./executionSimulator.js";
import { LatencyTracker } from "./latencyTracker.js";

/** Minimum gap between executions on the same pair+direction (ms). */
const EXECUTION_COOLDOWN_MS = 750;
/** Throttle for emitting repeated *rejected* opportunities on the same route. */
const OPPORTUNITY_THROTTLE_MS = 500;

export interface EngineEvents {
  opportunity: (opp: Opportunity) => void;
  trade: (trade: SimulatedTrade) => void;
  portfolio: (stats: PortfolioStats) => void;
  latency: (stats: LatencyStats) => void;
}

/**
 * Event-driven arbitrage engine. Evaluates on every book tick (no polling
 * loop), and only re-checks the pairs involving the exchange that just updated
 * — O(N) per update, not O(N²) over the whole cross-product. This is the core
 * of low detection latency.
 */
export class ArbitrageEngine extends EventEmitter {
  private readonly store = new OrderBookStore();
  private readonly risk: RiskManager;
  private readonly portfolio: Portfolio;
  private readonly simulator: ExecutionSimulator;
  private readonly latency = new LatencyTracker();
  private readonly lastTradeAt = new Map<string, number>();
  private readonly lastOppAt = new Map<string, number>();
  private referencePrice: number;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: EngineConfig) {
    super();
    this.referencePrice = 0;
    this.risk = new RiskManager(config);
    // Always provision a `demo` wallet so the demo/replay injector can execute,
    // regardless of whether demo mode is on at boot.
    const walletExchanges: ExchangeId[] = config.exchanges.includes("demo")
      ? config.exchanges
      : [...config.exchanges, "demo"];
    this.portfolio = new Portfolio(
      walletExchanges,
      startingBalances.usdPerExchange,
      startingBalances.btcPerExchange,
      this.referencePriceOr(60_000),
    );
    this.simulator = new ExecutionSimulator(this.portfolio);
  }

  start(): void {
    // Push aggregate stats on a fixed cadence (off the hot path) so the UI
    // stays smooth without re-rendering on every single book tick.
    this.statsTimer = setInterval(() => {
      this.emit("portfolio", this.portfolioStats());
      this.emit("latency", this.latencySnapshot());
    }, 500);
  }

  stop(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
  }

  /** Current mark-to-market reference price (mid of the latest real book). */
  currentReferencePrice(): number {
    return this.referencePrice;
  }

  /** Hot path: called on every incoming top-of-book update. */
  onBook(book: TopOfBook): void {
    this.store.update(book);
    this.latency.recordBook(book);
    // The demo venue is intentionally dislocated, so it must never drive the
    // mark-to-market reference used for equity.
    if (book.exchange !== "demo") {
      this.referencePrice = (book.bestBid + book.bestAsk) / 2;
    }

    for (const other of this.store.others(book.exchange)) {
      // Direction 1: buy on `book`, sell on `other`.
      this.evaluate(book, other, book);
      // Direction 2: buy on `other`, sell on `book`.
      this.evaluate(other, book, book);
    }
  }

  portfolioStats(): PortfolioStats {
    return this.portfolio.stats(this.referencePriceOr(60_000));
  }

  latencySnapshot(): LatencyStats {
    return this.latency.snapshot();
  }

  private evaluate(buyBook: TopOfBook, sellBook: TopOfBook, trigger: TopOfBook): void {
    // Only compare venues quoting the same asset. A BTC/USD book and a BTC/USDT
    // book differ by the USDT peg, so crossing them would surface a phantom
    // "arbitrage" that is really FX risk, not a free spread.
    if (buyBook.quote !== sellBook.quote) return;
    // Quick reject: only a gross cross (buy ask < sell bid) can be arbitrage.
    if (buyBook.bestAsk >= sellBook.bestBid) return;

    const buyFee = feeModels[buyBook.exchange].takerFee;
    const sellFee = feeModels[sellBook.exchange].takerFee;

    // Depth-walk for the net-profitable size. If fees eat the cross entirely,
    // fall back to a top-of-book valuation so we still surface the detection
    // and show *why* it was rejected (gross looked positive, net didn't).
    let calc = computeArbitrage(
      buyBook.asks,
      sellBook.bids,
      buyFee,
      sellFee,
      this.config.maxNotionalUsd,
    );
    if (calc.size <= 0) {
      calc = topOfBookArb(buyBook, sellBook, buyFee, sellFee, this.config.maxNotionalUsd);
    }
    if (calc.size <= 0) return;

    const now = Date.now();
    const decision = this.risk.evaluate(calc, buyBook, sellBook, now);

    const processingMs = now - trigger.receivedAt;
    this.latency.recordProcessing(processingMs);

    const opp: Opportunity = {
      id: randomUUID(),
      symbol: this.config.symbol,
      buyExchange: buyBook.exchange,
      sellExchange: sellBook.exchange,
      buyPrice: round2(calc.avgBuyPrice),
      sellPrice: round2(calc.avgSellPrice),
      size: round8(calc.size),
      grossProfit: round2(calc.grossProfit),
      netProfit: round2(calc.netProfit),
      netProfitPct: calc.cost > 0 ? calc.netProfit / calc.cost : 0,
      actionable: decision.ok,
      reason: decision.reason,
      latency: {
        feedMs:
          trigger.exchangeTime != null
            ? Math.max(0, trigger.receivedAt - trigger.exchangeTime)
            : null,
        processingMs: round3(processingMs),
      },
      detectedAt: now,
    };

    // Always surface executable opportunities; throttle repeated rejected ones
    // on the same route so a persistent sub-fee cross doesn't flood the feed.
    const routeKey = pairKey(buyBook.exchange, sellBook.exchange);
    const throttled =
      !opp.actionable &&
      now - (this.lastOppAt.get(routeKey) ?? 0) < OPPORTUNITY_THROTTLE_MS;
    if (throttled) return;
    this.lastOppAt.set(routeKey, now);

    this.portfolio.recordOpportunity(opp.actionable);
    this.emit("opportunity", opp);

    if (opp.actionable && this.cooldownReady(buyBook.exchange, sellBook.exchange, now)) {
      const trade = this.simulator.execute(opp, buyBook, sellBook);
      if (trade && trade.filledSize > 0) {
        this.portfolio.applyTrade(trade, this.referencePriceOr(trade.avgBuyPrice));
        this.lastTradeAt.set(pairKey(buyBook.exchange, sellBook.exchange), now);
        this.emit("trade", trade);
      }
    }
  }

  private cooldownReady(buy: ExchangeId, sell: ExchangeId, now: number): boolean {
    const last = this.lastTradeAt.get(pairKey(buy, sell)) ?? 0;
    return now - last >= EXECUTION_COOLDOWN_MS;
  }

  private referencePriceOr(fallback: number): number {
    return this.referencePrice > 0 ? this.referencePrice : fallback;
  }
}

function pairKey(buy: ExchangeId, sell: ExchangeId): string {
  return `${buy}->${sell}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

export interface ArbitrageEngine {
  on<E extends keyof EngineEvents>(event: E, listener: EngineEvents[E]): this;
  emit<E extends keyof EngineEvents>(
    event: E,
    ...args: Parameters<EngineEvents[E]>
  ): boolean;
}
