import { EventEmitter } from "node:events";
import type { TopOfBook } from "@arb/shared";

/** A captured real top-of-book tick, tagged with its receipt time. */
interface RecordedTick {
  t: number;
  book: TopOfBook;
}

/** Ring-buffer cap — bounded memory; ~this many recent real ticks are kept. */
const MAX_TICKS = 6_000;

/**
 * Rolling recorder of REAL market ticks. Every genuine (non-injected) top-of-
 * book update is appended; the buffer is capped so memory stays bounded no
 * matter how long the server runs. This is the tape the replay player streams
 * back — a reproducible slice of the actual market, not synthetic data.
 */
export class MarketRecorder {
  private buf: RecordedTick[] = [];

  record(book: TopOfBook): void {
    this.buf.push({ t: book.receivedAt, book });
    if (this.buf.length > MAX_TICKS) this.buf.shift();
  }

  /** Immutable copy of the current tape (oldest → newest). */
  snapshot(): RecordedTick[] {
    return this.buf.slice();
  }

  get size(): number {
    return this.buf.length;
  }

  /** Wall-clock span (ms) covered by the tape. */
  spanMs(): number {
    return this.buf.length > 1 ? this.buf[this.buf.length - 1].t - this.buf[0].t : 0;
  }
}

export interface ReplayEvents {
  book: (book: TopOfBook) => void;
}

/**
 * Replays a recorded tape of REAL market data back through the engine at a
 * variable speed, looping — a "grabación real" mode. Inter-tick gaps are scaled
 * by `1/speed`, and each replayed book's timestamps are rewritten to *now* so
 * the engine treats it as a live quote (the stale-quote guard would otherwise
 * reject decades-old… well, seconds-old… ticks). Clearly labeled in the UI, and
 * mutually exclusive with the synthetic demo injector.
 *
 * If replay is enabled before enough data has been captured, it waits and
 * re-checks rather than erroring — so a judge can flip it on early and it starts
 * as soon as there's a tape to play.
 */
export class ReplayPlayer extends EventEmitter {
  private tape: RecordedTick[] = [];
  private idx = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(
    private readonly getTape: () => RecordedTick[],
    private readonly getSpeed: () => number,
  ) {
    super();
  }

  get running(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.tape = this.getTape();
    this.idx = 0;
    this.scheduleNext();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.tape = [];
    this.idx = 0;
  }

  private scheduleNext(): void {
    if (!this.active) return;

    // Not enough tape yet — re-snapshot shortly (judge enabled replay early).
    if (this.tape.length < 2) {
      this.timer = setTimeout(() => {
        this.tape = this.getTape();
        this.idx = 0;
        this.scheduleNext();
      }, 500);
      return;
    }

    // Loop: on wrap, refresh the tape so newly-captured ticks join the replay.
    if (this.idx >= this.tape.length) {
      this.tape = this.getTape();
      this.idx = 0;
    }

    const tick = this.tape[this.idx];
    const now = Date.now();
    // Rewrite timestamps to now so the replayed quote reads as fresh.
    this.emit("book", { ...tick.book, receivedAt: now, exchangeTime: now });

    const next = this.tape[this.idx + 1];
    const gap = next ? Math.max(0, next.t - tick.t) : 200;
    const speed = Math.max(0.1, this.getSpeed());
    // Cap the per-step delay so a long gap (or the loop wrap) never stalls.
    const delay = Math.min(2_000, gap / speed);
    this.idx += 1;
    this.timer = setTimeout(() => this.scheduleNext(), delay);
  }
}

export interface ReplayPlayer {
  on<E extends keyof ReplayEvents>(event: E, listener: ReplayEvents[E]): this;
  emit<E extends keyof ReplayEvents>(
    event: E,
    ...args: Parameters<ReplayEvents[E]>
  ): boolean;
}
