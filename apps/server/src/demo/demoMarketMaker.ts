import { EventEmitter } from "node:events";
import type { BookLevel, TopOfBook } from "@arb/shared";
import { quoteAssetOf } from "../exchanges/symbols.js";

/**
 * Synthetic "demo" venue for the clearly-labeled demo/replay mode.
 *
 * It quotes around the live reference price and periodically injects a brief,
 * realistic price dislocation large enough to clear round-trip fees — so the
 * engine detects a genuinely net-positive arbitrage and exercises the full
 * execution path (partial fills, wallet drift, P&L). Outside those windows it
 * quotes a tight, no-arb spread.
 *
 * This is NOT real market data; the dashboard surfaces a prominent banner so it
 * can never be mistaken for a live opportunity.
 */
const TICK_MS = 200;
const CYCLE_MS = 6_000; // one dislocation event per cycle
const DISLOCATION_MS = 1_500; // how long each dislocation lasts
const DISLOCATION_PCT = 0.006; // 0.6% — comfortably above ~0.36% round-trip fees
const NORMAL_HALF_SPREAD = 0.0003;
const LEVELS = 12;
const LEVEL_STEP_PCT = 0.0002;
const LEVEL_SIZE = 0.25; // BTC per level

export interface DemoEvents {
  book: (book: TopOfBook) => void;
}

export class DemoMarketMaker extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly symbol: string,
    private readonly getReference: () => number,
  ) {
    super();
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const mid = this.getReference();
    if (mid <= 0) return; // wait for a real reference price first

    const now = Date.now();
    const phase = now % CYCLE_MS;
    const dislocated = phase < DISLOCATION_MS;
    // Alternate the direction of the dislocation each cycle for variety.
    const cycleIndex = Math.floor(now / CYCLE_MS);
    const direction: Dir = cycleIndex % 2 === 0 ? "buyCheap" : "sellRich";

    const { bestBid, bestAsk } = this.quote(mid, dislocated, direction);
    this.emit("book", {
      exchange: "demo",
      symbol: this.symbol,
      quote: quoteAssetOf(this.symbol),
      bids: ladder(bestBid, -1),
      asks: ladder(bestAsk, +1),
      bestBid,
      bestAsk,
      exchangeTime: now,
      receivedAt: now,
    });
  }

  private quote(
    mid: number,
    dislocated: boolean,
    direction: Dir,
  ): { bestBid: number; bestAsk: number } {
    if (!dislocated) {
      return {
        bestBid: mid * (1 - NORMAL_HALF_SPREAD),
        bestAsk: mid * (1 + NORMAL_HALF_SPREAD),
      };
    }
    if (direction === "buyCheap") {
      // Cheap ask: buy on demo, sell on a real venue (~mid) for net profit.
      const bestAsk = mid * (1 - DISLOCATION_PCT);
      return { bestAsk, bestBid: bestAsk * (1 - 2 * NORMAL_HALF_SPREAD) };
    }
    // Rich bid: buy on a real venue (~mid), sell on demo for net profit.
    const bestBid = mid * (1 + DISLOCATION_PCT);
    return { bestBid, bestAsk: bestBid * (1 + 2 * NORMAL_HALF_SPREAD) };
  }
}

type Dir = "buyCheap" | "sellRich";

/** Build a price ladder from `best`, stepping outward (`dir` = +1 asks, -1 bids). */
function ladder(best: number, dir: 1 | -1): BookLevel[] {
  const levels: BookLevel[] = [];
  for (let i = 0; i < LEVELS; i += 1) {
    const price = best * (1 + dir * LEVEL_STEP_PCT * i);
    levels.push([round2(price), LEVEL_SIZE] as BookLevel);
  }
  return levels;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DemoMarketMaker {
  on<E extends keyof DemoEvents>(event: E, listener: DemoEvents[E]): this;
  emit<E extends keyof DemoEvents>(
    event: E,
    ...args: Parameters<DemoEvents[E]>
  ): boolean;
}
