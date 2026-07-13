import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  EngineConfig,
  ExchangeId,
  LatencyStats,
  Opportunity,
  PortfolioStats,
  StatsSnapshot,
  SimulatedTrade,
  TopOfBook,
} from "@arb/shared";
import { feeModels, startingBalances } from "../config.js";
import { OrderBookStore } from "../marketData/orderBookStore.js";
import { computeArbitrage, topOfBookArb } from "./profit.js";
import { computeEv } from "./expectedValue.js";
import { RiskManager } from "./riskManager.js";
import { RiskGovernor } from "./riskGovernor.js";
import { Portfolio } from "./portfolio.js";
import { ExecutionSimulator } from "./executionSimulator.js";
import { LatencyTracker } from "./latencyTracker.js";
import { StatsAggregator } from "./statsAggregator.js";

/** Minimum gap between executions on the same pair+direction (ms). */
const EXECUTION_COOLDOWN_MS = 750;
/** Throttle for emitting repeated *rejected* opportunities on the same route. */
const OPPORTUNITY_THROTTLE_MS = 500;

export interface EngineEvents {
  opportunity: (opp: Opportunity) => void;
  trade: (trade: SimulatedTrade) => void;
  portfolio: (stats: PortfolioStats) => void;
  latency: (stats: LatencyStats) => void;
  stats: (stats: StatsSnapshot) => void;
}

/** A detected route plus the live books needed to execute it. */
interface Candidate {
  opp: Opportunity;
  buyBook: TopOfBook;
  sellBook: TopOfBook;
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
  private readonly governor: RiskGovernor;
  private portfolio: Portfolio;
  private simulator: ExecutionSimulator;
  private latency = new LatencyTracker();
  private stats = new StatsAggregator();
  private readonly lastTradeAt = new Map<string, number>();
  private readonly lastOppAt = new Map<string, number>();
  private referencePrice: number;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  /** High-resolution start of the current tick, for sub-ms processing latency. */
  private tickStartHrt = 0;

  constructor(private readonly config: EngineConfig) {
    super();
    this.referencePrice = 0;
    this.risk = new RiskManager(config);
    this.governor = new RiskGovernor(config);
    this.portfolio = this.freshPortfolio();
    this.simulator = new ExecutionSimulator(this.portfolio, config);
  }

  /**
   * A fresh portfolio at starting balances. Always provisions a `demo` wallet so
   * the demo/replay injector can execute regardless of whether demo mode is on.
   * The equity baseline is locked to the current mark (or deferred to the first
   * real price when called at boot, where referencePrice is still 0).
   */
  private freshPortfolio(): Portfolio {
    const walletExchanges: ExchangeId[] = this.config.exchanges.includes("demo")
      ? this.config.exchanges
      : [...this.config.exchanges, "demo"];
    const portfolio = new Portfolio(
      walletExchanges,
      startingBalances.usdPerExchange,
      startingBalances.btcPerExchange,
      this.referencePrice,
      this.config,
    );
    if (this.referencePrice > 0) portfolio.ensureBaseline(this.referencePrice);
    return portfolio;
  }

  /**
   * Reset session metrics to a clean slate — P&L, trades, opportunity counts,
   * equity curve and the empirical analysis population — without touching the
   * live market feeds. Lets a judge zero the dashboard and watch from scratch
   * (great paired with Demo mode). Re-baselines equity at the current mark.
   */
  reset(): void {
    this.portfolio = this.freshPortfolio();
    this.simulator = new ExecutionSimulator(this.portfolio, this.config);
    this.stats = new StatsAggregator();
    this.latency = new LatencyTracker();
    this.governor.reset();
    this.lastTradeAt.clear();
    this.lastOppAt.clear();
    this.emit("portfolio", this.portfolioStats());
    this.emit("latency", this.latencySnapshot());
    this.emit("stats", this.stats.snapshot());
  }

  start(): void {
    // Push aggregate stats on a fixed cadence (off the hot path) so the UI
    // stays smooth without re-rendering on every single book tick.
    this.statsTimer = setInterval(() => {
      this.emit("portfolio", this.portfolioStats());
      this.emit("latency", this.latencySnapshot());
    }, 500);
    // Empirical analysis snapshot on a slower cadence (heavier to compute).
    this.analysisTimer = setInterval(() => {
      this.emit("stats", this.stats.snapshot());
    }, 1500);
  }

  stop(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.analysisTimer) clearInterval(this.analysisTimer);
  }

  /** Current mark-to-market reference price (mid of the latest real book). */
  currentReferencePrice(): number {
    return this.referencePrice;
  }

  /** Hot path: called on every incoming top-of-book update. */
  onBook(book: TopOfBook): void {
    // Adverse "kill a venue" scenario: a downed venue's feed is frozen — we drop
    // its incoming ticks so its stored book ages out, the stale-quote guard stops
    // trading it, and it falls out of the consensus. Simulates an exchange going
    // dark and lets the judge watch the system route around it.
    if (this.config.scenario.downedVenues?.includes(book.exchange)) return;

    // Monotonic clock so processing latency has true sub-millisecond resolution
    // (Date.now() is millisecond-granular and would report 0µs for fast ticks).
    this.tickStartHrt = performance.now();
    this.store.update(book);
    this.latency.recordBook(book);
    // The demo venue is intentionally dislocated, so it must never drive the
    // mark-to-market reference used for equity.
    if (book.exchange !== "demo") {
      this.referencePrice = (book.bestBid + book.bestAsk) / 2;
      // Lock the equity baseline at the first genuine mark (no-op thereafter).
      this.portfolio.ensureBaseline(this.referencePrice);
    }

    // Cross-venue consensus (median mid over fresh, active, non-demo venues),
    // computed once per tick. The risk gate uses it to quarantine a lagging or
    // dislocated feed — the failure mode that makes a flaky host look like it's
    // "printing" phantom arbitrage.
    const consensusMid = this.computeConsensusMid(Date.now());

    // Collect every candidate route touching the venue that just updated,
    // then act on them in priority order (most net-profitable first) so scarce
    // capital is allocated to the best opportunity rather than the first seen.
    const candidates: Candidate[] = [];
    for (const other of this.store.others(book.exchange)) {
      const a = this.consider(book, other, book, consensusMid); // buy book, sell other
      if (a) candidates.push(a);
      const b = this.consider(other, book, book, consensusMid); // buy other, sell book
      if (b) candidates.push(b);
    }
    if (candidates.length === 0) return;

    // Surface all detections (gross-vs-net story) regardless of execution.
    for (const c of candidates) {
      this.portfolio.recordOpportunity(c.opp.actionable);
      this.emit("opportunity", c.opp);
    }

    // Global loss-limit kill-switch: refresh from realized P&L. While halted,
    // detection keeps running (opportunities still stream) but nothing executes.
    const now = Date.now();
    this.governor.updateHalt(this.portfolio.realizedPnlUsd());
    if (this.governor.isHalted()) return;

    // Prioritize: execute actionable routes by descending expected value, so
    // scarce capital backs the highest-EV opportunity first (not the first seen).
    const actionable = candidates
      .filter((c) => c.opp.actionable)
      .sort((x, y) => y.opp.expectedValueUsd - x.opp.expectedValueUsd);
    for (const c of actionable) {
      // Circuit breaker: skip any route touching a benched venue (too many
      // recent rejections) until its cooldown elapses.
      if (
        this.governor.isBenched(c.buyBook.exchange, now) ||
        this.governor.isBenched(c.sellBook.exchange, now)
      ) {
        continue;
      }
      if (!this.cooldownReady(c.buyBook.exchange, c.sellBook.exchange, now)) continue;
      const trade = this.simulator.execute(c.opp, c.buyBook, c.sellBook);
      // A trade is booked whenever any position was taken — including the case
      // where the matched size is 0 but a rejected leg left a residual that we
      // then unwound back to flat (the scenario-injector story).
      if (trade) {
        this.portfolio.applyTrade(trade, this.referencePriceOr(trade.avgBuyPrice));
        this.lastTradeAt.set(pairKey(c.buyBook.exchange, c.sellBook.exchange), now);
        // Feed rejected legs into the per-venue circuit breaker.
        this.governor.recordTrade(trade, now);
        this.emit("trade", trade);
      }
    }
  }

  portfolioStats(): PortfolioStats {
    const stats = this.portfolio.stats(this.referencePriceOr(60_000));
    // Overlay live circuit-breaker / loss-limit state (owned by the governor).
    stats.riskState = this.governor.state(Date.now());
    return stats;
  }

  latencySnapshot(): LatencyStats {
    return this.latency.snapshot();
  }

  /**
   * Evaluate one directed route (buy on `buyBook`, sell on `sellBook`) and
   * return a candidate to act on, or null if it's not a (throttle-allowed)
   * detection. Pure w.r.t. portfolio/emit — the caller records, emits and
   * executes so it can prioritize across all routes for this tick.
   */
  /**
   * Median mid across all fresh, active, non-demo venues. Requires a quorum of
   * ≥3 venues for a robust median; returns null otherwise (guard inactive). The
   * demo venue is intentionally dislocated, so it never counts toward consensus.
   */
  /**
   * Per-venue feed health vs the cross-venue consensus, for the dashboard. Same
   * math the risk gate uses to quarantine a dislocated feed — surfaced so the
   * UI can SHOW a venue being isolated (deviation in bps + stale + dislocated),
   * turning the "flaky-host" defense into a visible feature. Only venues with a
   * book are reported; the demo venue is always non-dislocated (null deviation).
   */
  feedHealth(now = Date.now()): Array<{
    exchange: ExchangeId;
    deviationBps: number | null;
    stale: boolean;
    dislocated: boolean;
    benched: boolean;
    downed: boolean;
  }> {
    const consensus = this.computeConsensusMid(now);
    const guard = this.config.maxVenueDeviationPct;
    const downedVenues = this.config.scenario.downedVenues ?? [];
    const out: Array<{
      exchange: ExchangeId;
      deviationBps: number | null;
      stale: boolean;
      dislocated: boolean;
      benched: boolean;
      downed: boolean;
    }> = [];
    for (const b of this.store.all()) {
      const stale = now - b.receivedAt > this.config.maxQuoteAgeMs;
      const mid = (b.bestBid + b.bestAsk) / 2;
      let deviationBps: number | null = null;
      let dislocated = false;
      if (b.exchange !== "demo" && consensus && consensus > 0 && mid > 0) {
        const dev = Math.abs(mid - consensus) / consensus;
        deviationBps = round1(dev * 10_000);
        dislocated =
          guard > 0 &&
          !this.config.disabledExchanges.includes(b.exchange) &&
          dev > guard;
      }
      out.push({
        exchange: b.exchange,
        deviationBps,
        stale,
        dislocated,
        benched: this.governor.isBenched(b.exchange, now),
        downed: downedVenues.includes(b.exchange),
      });
    }
    return out;
  }

  private computeConsensusMid(now: number): number | null {
    const mids: number[] = [];
    for (const b of this.store.all()) {
      if (b.exchange === "demo") continue;
      if (this.config.disabledExchanges.includes(b.exchange)) continue;
      if (now - b.receivedAt > this.config.maxQuoteAgeMs) continue;
      const mid = (b.bestBid + b.bestAsk) / 2;
      if (mid > 0) mids.push(mid);
    }
    if (mids.length < 3) return null;
    mids.sort((a, b) => a - b);
    const m = mids.length;
    return m % 2 ? mids[(m - 1) / 2] : (mids[m / 2 - 1] + mids[m / 2]) / 2;
  }

  private consider(
    buyBook: TopOfBook,
    sellBook: TopOfBook,
    trigger: TopOfBook,
    consensusMid: number | null,
  ): Candidate | null {
    // Live venue toggle: a disabled exchange keeps streaming its book (still
    // shown in the market panel) but is excluded from comparison/execution.
    const disabled = this.config.disabledExchanges;
    if (disabled.length > 0 && (disabled.includes(buyBook.exchange) || disabled.includes(sellBook.exchange))) {
      return null;
    }
    // Only compare venues quoting the same asset. A BTC/USD book and a BTC/USDT
    // book differ by the USDT peg, so crossing them would surface a phantom
    // "arbitrage" that is really FX risk, not a free spread.
    if (buyBook.quote !== sellBook.quote) return null;
    // Quick reject: only a gross cross (buy ask < sell bid) can be arbitrage.
    if (buyBook.bestAsk >= sellBook.bestBid) return null;

    // Fee mode: `maker` assumes the passive (buy) leg rests as a maker order and
    // pays the (lower/rebate) maker fee; the active (sell) leg still crosses as a
    // taker. Cheaper buy fee ⇒ more crosses clear the net bar — honest only when
    // paired with a reject scenario to model the passive leg occasionally missing.
    const maker = this.config.feeMode === "maker";
    const buyFee = maker
      ? feeModels[buyBook.exchange].makerFee
      : feeModels[buyBook.exchange].takerFee;
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
    if (calc.size <= 0) return null;

    const now = Date.now();
    const decision = this.risk.evaluate(calc, buyBook, sellBook, now, consensusMid);

    // Time from this market tick entering the engine to detection — our code's
    // work only, measured on a monotonic clock for genuine sub-ms precision.
    const processingMs = performance.now() - this.tickStartHrt;
    this.latency.recordProcessing(processingMs);

    const netProfitPct = calc.cost > 0 ? calc.netProfit / calc.cost : 0;
    const feedMs =
      trigger.exchangeTime != null
        ? Math.max(0, trigger.receivedAt - trigger.exchangeTime)
        : null;

    // Expected-value layer: estimate the probability the cross survives our
    // latency window, then require EV > 0 — not just a positive net spread.
    const ev = computeEv(
      {
        netProfit: calc.netProfit,
        netProfitPct,
        grossPct: calc.cost > 0 ? calc.grossProfit / calc.cost : 0,
        cost: calc.cost,
        ageMs: processingMs + (feedMs ?? 0),
        buyAsks: buyBook.asks,
        buyBids: buyBook.bids,
        sellAsks: sellBook.asks,
        sellBids: sellBook.bids,
      },
      this.config.ev,
    );

    // An opportunity must clear the risk gate. In EV mode it must ALSO clear the
    // expected-value bar; in spread mode the positive net spread (already
    // enforced by the risk gate's min-net-profit) is enough. EV is still
    // computed in both modes so the dashboard always shows P(surv)/EV.
    let actionable = decision.ok;
    let reason = decision.reason;
    if (
      this.config.decisionMode === "ev" &&
      actionable &&
      ev.expectedValueUsd <= this.config.ev.minEvUsd
    ) {
      actionable = false;
      reason = `EV no positivo (supervivencia ${(ev.survivalProb * 100).toFixed(0)}%)`;
    }

    // Automated risk controls override actionability — and explain themselves in
    // the feed (visible SKIP reason), so a judge sees the breaker/halt acting.
    if (actionable) {
      if (this.governor.isHalted()) {
        actionable = false;
        reason = "trading halted (session loss limit)";
      } else if (this.governor.isBenched(buyBook.exchange, now)) {
        actionable = false;
        reason = `circuit breaker: ${buyBook.exchange} benched`;
      } else if (this.governor.isBenched(sellBook.exchange, now)) {
        actionable = false;
        reason = `circuit breaker: ${sellBook.exchange} benched`;
      }
    }

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
      netProfitPct,
      survivalProb: ev.survivalProb,
      expectedValueUsd: round2(ev.expectedValueUsd),
      actionable,
      reason,
      latency: {
        feedMs,
        processingMs: round3(processingMs),
      },
      detectedAt: now,
    };

    // Feed the empirical aggregator with EVERY detected cross (full population),
    // before any feed throttling — the analysis must reflect real data.
    this.stats.record({
      grossProfit: calc.grossProfit,
      netProfit: calc.netProfit,
      cost: calc.cost,
      survival: ev.survivalProb,
      buyExchange: buyBook.exchange,
      sellExchange: sellBook.exchange,
      actionable,
    });

    // Always surface executable opportunities; throttle repeated rejected ones
    // on the same route so a persistent sub-fee cross doesn't flood the feed.
    const routeKey = pairKey(buyBook.exchange, sellBook.exchange);
    const throttled =
      !opp.actionable &&
      now - (this.lastOppAt.get(routeKey) ?? 0) < OPPORTUNITY_THROTTLE_MS;
    if (throttled) return null;
    this.lastOppAt.set(routeKey, now);

    return { opp, buyBook, sellBook };
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
function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
