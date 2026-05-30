import type { BookLevel, EvConfig } from "@arb/shared";

/**
 * Transparent expected-value model. This is NOT a black-box ML model — it is an
 * interpretable heuristic over real microstructure features, so every number on
 * the dashboard can be explained to a judge:
 *
 *   survival ≈ decay(age) · edgeConfidence(netPct) · liquiditySupport(imbalance)
 *   EV       = survival · netProfit − (1 − survival) · adverseCost
 *
 * The point: we fire on positive EXPECTED VALUE, not on a raw spread threshold.
 * A thin edge seen on a stale quote has low survival → negative EV → skipped,
 * even though its gross spread looked positive.
 */

/** Edge (as a fraction) at which edge-confidence reaches 0.5. ~5 bps. */
const HALF_EDGE_PCT = 0.0005;

export interface EvResult {
  survivalProb: number;
  expectedValueUsd: number;
  /** Depth-share at the buy venue's ask vs its top liquidity [0..1]. */
  buyImbalance: number;
  /** Depth-share at the sell venue's bid vs its top liquidity [0..1]. */
  sellImbalance: number;
}

export interface EvInputs {
  netProfit: number;
  netProfitPct: number;
  /**
   * Gross spread as a fraction of notional. Survival is about whether the
   * observed *price dislocation* persists, which is independent of our fees, so
   * edge-confidence keys off the gross edge — otherwise every sub-fee cross
   * would collapse to the same floor survival.
   */
  grossPct: number;
  /** Quote spent (notional) — basis for the adverse-selection cost. */
  cost: number;
  /** Total staleness of the quotes we'd act on (feed + processing), ms. */
  ageMs: number;
  buyAsks: BookLevel[];
  buyBids: BookLevel[];
  sellAsks: BookLevel[];
  sellBids: BookLevel[];
}

const LEVELS = 10;

export function computeEv(inputs: EvInputs, cfg: EvConfig): EvResult {
  const buyImbalance = depthShare(inputs.buyAsks, inputs.buyBids);
  const sellImbalance = depthShare(inputs.sellBids, inputs.sellAsks);

  const survivalProb = estimateSurvival(
    inputs.grossPct,
    inputs.ageMs,
    buyImbalance,
    sellImbalance,
    cfg,
  );

  const adverseCost = Math.max(0, inputs.cost) * (cfg.adverseBps / 10_000);
  const expectedValueUsd =
    survivalProb * inputs.netProfit - (1 - survivalProb) * adverseCost;

  return { survivalProb, expectedValueUsd, buyImbalance, sellImbalance };
}

/**
 * Probability the favorable cross survives our latency window.
 * - decay: fresher quotes survive better (exp decay with τ).
 * - edge confidence: a fatter edge is less likely to be noise that reverts.
 * - liquidity support: deeper supporting depth makes the cross less ephemeral.
 */
export function estimateSurvival(
  grossPct: number,
  ageMs: number,
  buyImbalance: number,
  sellImbalance: number,
  cfg: EvConfig,
): number {
  const decay = Math.exp(-Math.max(0, ageMs) / cfg.tauMs);

  const edge = Math.max(0, grossPct);
  const edgeConfidence = edge / (edge + HALF_EDGE_PCT);

  // Average supporting-side depth share, mapped to a mild [0.7, 1.0] multiplier.
  const support = (buyImbalance + sellImbalance) / 2;
  const liquiditySupport = 0.7 + 0.3 * clamp01(support);

  return clamp(decay * edgeConfidence * liquiditySupport, 0.01, 0.99);
}

/** Fraction of top-N depth on `primary` vs the opposite side (0..1). */
function depthShare(primary: BookLevel[], opposite: BookLevel[]): number {
  const p = sumSize(primary);
  const o = sumSize(opposite);
  const total = p + o;
  return total > 0 ? p / total : 0.5;
}

function sumSize(levels: BookLevel[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(LEVELS, levels.length); i += 1) s += levels[i][1];
  return s;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function clamp01(n: number): number {
  return clamp(n, 0, 1);
}
