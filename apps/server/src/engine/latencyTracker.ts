import type {
  ExchangeId,
  LatencyStats,
  PercentileStats,
  TopOfBook,
} from "@arb/shared";

const WINDOW = 1000;

/**
 * Rolling latency bookkeeping. We separate:
 *  - processing latency (detectedAt - receivedAt): purely our code, the number
 *    we own and optimise, independent of clock skew.
 *  - feed latency (receivedAt - exchangeTime): network + exchange, indicative.
 * Plus the age of the last update per feed, to flag stale connections.
 */
export class LatencyTracker {
  private readonly processing: number[] = [];
  private readonly feed: number[] = [];
  private readonly lastUpdate = new Map<ExchangeId, number>();

  recordBook(book: TopOfBook): void {
    this.lastUpdate.set(book.exchange, book.receivedAt);
    if (book.exchangeTime != null) {
      push(this.feed, Math.max(0, book.receivedAt - book.exchangeTime));
    }
  }

  recordProcessing(ms: number): void {
    push(this.processing, Math.max(0, ms));
  }

  snapshot(): LatencyStats {
    const now = Date.now();
    const feedAgeMs: Partial<Record<ExchangeId, number>> = {};
    for (const [id, t] of this.lastUpdate) feedAgeMs[id] = now - t;

    return {
      processing: percentiles(this.processing),
      feed: percentiles(this.feed),
      feedAgeMs,
    };
  }
}

function push(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > WINDOW) arr.shift();
}

function percentiles(values: number[]): PercentileStats {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    p50: round(at(50)),
    p95: round(at(95)),
    p99: round(at(99)),
    count: sorted.length,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
