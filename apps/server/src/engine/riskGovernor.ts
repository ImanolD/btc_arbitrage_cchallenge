import type { EngineConfig, ExchangeId, RiskState, SimulatedTrade } from "@arb/shared";

/**
 * Automated, self-clearing risk controls layered ON TOP of the per-trade risk
 * gate — the "circuit breaker + exposure limits" a real desk runs:
 *
 * - **Per-venue circuit breaker.** Counts leg *rejections* per venue in a
 *   rolling window. When a venue rejects too often (`breakerRejects` within
 *   `breakerWindowMs`) it's *benched* from execution for `breakerCooldownMs`,
 *   then auto-recovers. This isolates a misbehaving venue instead of hammering
 *   it — and it's exactly what the reject scenario lets a judge trigger live.
 *
 * - **Session loss limit (kill-switch).** When realized P&L falls to or below
 *   −`maxSessionLossUsd`, ALL execution halts (detection keeps running) until
 *   the session is reset. The global drawdown breaker.
 *
 * Reads limits from the shared config by reference, so they're live-tunable.
 * Pure/among-itself: it decides, the engine enforces and narrates.
 */
export class RiskGovernor {
  /** Recent rejection timestamps per venue (pruned to the window on read). */
  private readonly rejects = new Map<ExchangeId, number[]>();
  /** Epoch ms until which a venue stays benched (0/absent = active). */
  private readonly benchedUntil = new Map<ExchangeId, number>();
  private halted = false;
  private haltReason: string | undefined;

  constructor(private readonly config: EngineConfig) {}

  /** Wipe all breaker/halt state (used on session reset). */
  reset(): void {
    this.rejects.clear();
    this.benchedUntil.clear();
    this.halted = false;
    this.haltReason = undefined;
  }

  /** Is execution globally halted (loss limit tripped)? */
  isHalted(): boolean {
    return this.halted;
  }

  /** Is this venue currently benched by its circuit breaker? */
  isBenched(exchange: ExchangeId, now: number): boolean {
    const until = this.benchedUntil.get(exchange);
    if (until === undefined) return false;
    if (now >= until) {
      // Cooldown elapsed: auto-recover and forget the stale rejection history.
      this.benchedUntil.delete(exchange);
      this.rejects.delete(exchange);
      return false;
    }
    return true;
  }

  /**
   * Re-evaluate the global loss-limit halt against realized P&L. Returns the
   * transition ("halted" | "resumed") when it flips, else null — so the caller
   * can narrate it. Once tripped, the halt stays until realized P&L recovers
   * above the limit (or the session is reset), avoiding halt/resume flapping.
   */
  updateHalt(realizedPnlUsd: number): "halted" | "resumed" | null {
    const limit = this.config.riskLimits.maxSessionLossUsd;
    const shouldHalt = limit > 0 && realizedPnlUsd <= -limit;
    if (shouldHalt && !this.halted) {
      this.halted = true;
      this.haltReason = `session loss ${realizedPnlUsd.toFixed(0)} ≤ −${limit}`;
      return "halted";
    }
    if (!shouldHalt && this.halted) {
      this.halted = false;
      this.haltReason = undefined;
      return "resumed";
    }
    return null;
  }

  /**
   * Fold a completed trade's rejected legs into the breaker counters and trip
   * any venue that crossed its threshold. Returns the venues *newly* benched by
   * this trade (for narration).
   */
  recordTrade(trade: SimulatedTrade, now: number): ExchangeId[] {
    const limit = this.config.riskLimits.breakerRejects;
    if (limit <= 0) return [];
    const newlyBenched: ExchangeId[] = [];
    for (const leg of [trade.buyLeg, trade.sellLeg]) {
      if (!leg || leg.state !== "rejected") continue;
      const ex = leg.exchange;
      if (this.benchedUntil.has(ex)) continue; // already benched
      const window = this.config.riskLimits.breakerWindowMs;
      const times = (this.rejects.get(ex) ?? []).filter((t) => now - t < window);
      times.push(now);
      this.rejects.set(ex, times);
      if (times.length >= limit) {
        this.benchedUntil.set(ex, now + this.config.riskLimits.breakerCooldownMs);
        this.rejects.delete(ex);
        newlyBenched.push(ex);
      }
    }
    return newlyBenched;
  }

  /** Venues currently benched (auto-recovering any whose cooldown elapsed). */
  benchedVenues(now: number): ExchangeId[] {
    const out: ExchangeId[] = [];
    for (const ex of [...this.benchedUntil.keys()]) {
      if (this.isBenched(ex, now)) out.push(ex);
    }
    return out;
  }

  /** Snapshot for the dashboard. */
  state(now: number): RiskState {
    return {
      halted: this.halted,
      haltReason: this.haltReason,
      benched: this.benchedVenues(now),
    };
  }
}
