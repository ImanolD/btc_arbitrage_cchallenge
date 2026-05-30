import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ExchangeId, TopOfBook, TriangularOpportunity } from "@arb/shared";
import { feeModels } from "../config.js";

/** Throttle for emitting repeated triangular evaluations. */
const EMIT_THROTTLE_MS = 500;

export interface TriangularEvents {
  triangular: (opp: TriangularOpportunity) => void;
}

interface Pairs {
  /** base/quote, e.g. BTC/USDT */
  btcQuote: string;
  /** intermediate/base, e.g. ETH/BTC */
  interBase: string;
  /** intermediate/quote, e.g. ETH/USDT */
  interQuote: string;
}

/**
 * Triangular arbitrage on a single venue. Converts quote → base → intermediate
 * → quote (forward) and the reverse, and checks whether a full loop ends with
 * more quote currency than it started, net of three taker fees.
 *
 * Uses top-of-book pricing on a fixed notional — the standard way to detect a
 * triangular edge. Like the cross-exchange engine it surfaces the best cycle
 * even when negative, so the dashboard shows the strategy working and *why*
 * the loop does or doesn't clear fees.
 */
export class TriangularEngine extends EventEmitter {
  private readonly books = new Map<string, TopOfBook>();
  private readonly fee: number;
  private lastEmit = 0;

  constructor(
    private readonly exchange: ExchangeId,
    private readonly pairs: Pairs,
    private readonly displayPairs: string[],
    private readonly notionalUsd: number,
    private readonly minNetProfitUsd: number,
  ) {
    super();
    this.fee = feeModels[exchange].takerFee;
  }

  /** Feed a fresh book for one of the three monitored symbols. */
  onBook(symbol: string, book: TopOfBook): void {
    this.books.set(symbol, book);
    this.evaluate(book.receivedAt);
  }

  private evaluate(now: number): void {
    const btcQuote = this.books.get(this.pairs.btcQuote);
    const interBase = this.books.get(this.pairs.interBase);
    const interQuote = this.books.get(this.pairs.interQuote);
    if (!btcQuote || !interBase || !interQuote) return;

    const fwd = this.forward(btcQuote, interBase, interQuote);
    const rev = this.reverse(btcQuote, interBase, interQuote);

    // Emit immediately if either cycle is actionable; otherwise throttle so the
    // dashboard refreshes both directions a couple of times per second.
    const actionable = fwd.actionable || rev.actionable;
    if (!actionable && now - this.lastEmit < EMIT_THROTTLE_MS) return;
    this.lastEmit = now;
    this.emit("triangular", { ...fwd, detectedAt: now });
    this.emit("triangular", { ...rev, detectedAt: now });
  }

  /** USDT → BTC → ETH → USDT. */
  private forward(
    btcQuote: TopOfBook,
    interBase: TopOfBook,
    interQuote: TopOfBook,
  ): Omit<TriangularOpportunity, "detectedAt"> {
    const f = 1 - this.fee;
    const start = this.notionalUsd;
    const btc = (start / btcQuote.bestAsk) * f; // buy BTC with USDT
    const eth = (btc / interBase.bestAsk) * f; // buy ETH with BTC
    const end = eth * interQuote.bestBid * f; // sell ETH for USDT
    return this.build("forward", start, end, [
      { pair: this.displayPairs[0], side: "buy", price: btcQuote.bestAsk },
      { pair: this.displayPairs[1], side: "buy", price: interBase.bestAsk },
      { pair: this.displayPairs[2], side: "sell", price: interQuote.bestBid },
    ], ["USDT", "BTC", "ETH", "USDT"]);
  }

  /** USDT → ETH → BTC → USDT. */
  private reverse(
    btcQuote: TopOfBook,
    interBase: TopOfBook,
    interQuote: TopOfBook,
  ): Omit<TriangularOpportunity, "detectedAt"> {
    const f = 1 - this.fee;
    const start = this.notionalUsd;
    const eth = (start / interQuote.bestAsk) * f; // buy ETH with USDT
    const btc = eth * interBase.bestBid * f; // sell ETH for BTC
    const end = btc * btcQuote.bestBid * f; // sell BTC for USDT
    return this.build("reverse", start, end, [
      { pair: this.displayPairs[2], side: "buy", price: interQuote.bestAsk },
      { pair: this.displayPairs[1], side: "sell", price: interBase.bestBid },
      { pair: this.displayPairs[0], side: "sell", price: btcQuote.bestBid },
    ], ["USDT", "ETH", "BTC", "USDT"]);
  }

  private build(
    direction: "forward" | "reverse",
    start: number,
    end: number,
    legs: TriangularOpportunity["legs"],
    path: string[],
  ): Omit<TriangularOpportunity, "detectedAt"> {
    const netProfit = end - start;
    const netProfitPct = netProfit / start;
    const actionable = netProfit >= this.minNetProfitUsd;
    return {
      id: randomUUID(),
      exchange: this.exchange,
      direction,
      path,
      legs,
      startAmount: round2(start),
      endAmount: round2(end),
      // Gross ≈ loop result with zero fees, for the gross-vs-net comparison.
      grossProfit: round2(this.grossOf(end) - start),
      netProfit: round2(netProfit),
      netProfitPct,
      actionable,
      reason: actionable ? undefined : "loop does not clear fees",
    };
  }

  /** Re-inflate the fee-adjusted end amount to an approximate gross figure. */
  private grossOf(netEnd: number): number {
    return netEnd / (1 - this.fee) ** 3;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface TriangularEngine {
  on<E extends keyof TriangularEvents>(event: E, listener: TriangularEvents[E]): this;
  emit<E extends keyof TriangularEvents>(
    event: E,
    ...args: Parameters<TriangularEvents[E]>
  ): boolean;
}
