/**
 * @arb/shared — the single source of truth for the data contract between the
 * server (bot) and the web (dashboard). Both apps import these types so the
 * Socket.IO event payloads can never drift out of sync.
 */

export type ExchangeId =
  | "binance"
  | "kraken"
  | "coinbase"
  | "okx"
  | "bybit"
  | "kucoin"
  | "gate"
  | "bitstamp"
  | "bitfinex"
  /** Synthetic venue used only by the clearly-labeled demo/replay mode. */
  | "demo";

/** Quote currency a book is denominated in (used to group comparable venues). */
export type QuoteAsset = "USDT" | "USD" | "USDC";

export type OrderSide = "buy" | "sell";

/** A single price level in an order book: [price, quantity]. */
export type BookLevel = readonly [price: number, quantity: number];

/**
 * A snapshot of the top of an exchange's order book for one symbol.
 * `bids` are sorted descending by price, `asks` ascending.
 */
export interface TopOfBook {
  exchange: ExchangeId;
  symbol: string;
  /** Quote currency; only books with the same quote are compared for arbitrage. */
  quote: QuoteAsset;
  bids: BookLevel[];
  asks: BookLevel[];
  /** Best bid/ask convenience fields (level 0). */
  bestBid: number;
  bestAsk: number;
  /** Exchange-provided event time (ms epoch), when available. */
  exchangeTime: number | null;
  /** Local time the message was received (ms epoch, high-resolution origin). */
  receivedAt: number;
}

/** Per-exchange trading cost model (published fee schedule). */
export interface FeeModel {
  /** Taker fee as a fraction, e.g. 0.001 = 0.1%. */
  takerFee: number;
  /**
   * Maker (post-only) fee as a fraction — usually below taker, sometimes a
   * rebate (negative). Only charged in `maker` fee mode, which models resting
   * the passive leg instead of crossing the spread on it. See `FeeMode`.
   */
  makerFee: number;
  /** Estimated BTC withdrawal fee (only used by the transfer model). */
  withdrawalFeeBtc: number;
}

/**
 * Which side of the book we assume our orders take, per leg — a real cost/risk
 * trade-off, not a cosmetic toggle:
 * - `taker` (default): both legs cross the spread and pay the taker fee. Certain
 *   fill, higher cost. Correct for a latency-sensitive arbitrage that must grab
 *   the edge before it evaporates.
 * - `maker`: the passive (buy) leg is assumed to rest as a maker order, paying
 *   the (lower/rebate) maker fee. Cheaper, so MORE crosses clear the net-profit
 *   bar — but maker fills are not guaranteed, so this is honest only when paired
 *   with a non-zero reject scenario (models the passive leg missing). The active
 *   (sell) leg still crosses as a taker.
 */
export type FeeMode = "taker" | "maker";

/**
 * A detected arbitrage opportunity: buy on `buyExchange` (at its ask),
 * sell on `sellExchange` (at its bid).
 */
export interface Opportunity {
  id: string;
  symbol: string;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  /** Best ask we buy at and best bid we sell at, at detection time. */
  buyPrice: number;
  sellPrice: number;
  /** Size (in base asset, BTC) that is actually executable after depth-walking. */
  size: number;
  /** Gross spread profit before any costs (quote currency). */
  grossProfit: number;
  /** Profit after fees + slippage (quote currency). The number that matters. */
  netProfit: number;
  /** Net profit as a fraction of notional. */
  netProfitPct: number;
  /**
   * Estimated probability (0..1) that the favorable cross survives our latency
   * window long enough to execute. Transparent heuristic — see expectedValue.ts.
   */
  survivalProb: number;
  /**
   * Expected value (quote currency): survivalProb × netProfit minus the
   * probability-weighted adverse-selection cost if the edge collapses. The
   * engine fires on EV > 0, not merely on a positive net spread.
   */
  expectedValueUsd: number;
  /** Whether the engine decided this opportunity is worth executing. */
  actionable: boolean;
  /** Human-readable reason when not actionable (e.g. "below min profit"). */
  reason?: string;
  /** Latency breakdown for this detection (ms). */
  latency: LatencySample;
  detectedAt: number;
}

/** One leg of a triangular cycle (a single trade on one pair). */
export interface TriangularLeg {
  pair: string;
  side: OrderSide;
  price: number;
}

/**
 * A triangular arbitrage cycle on a single exchange: convert quote → base →
 * intermediate → quote (or the reverse) and check whether you end with more
 * quote currency than you started, net of three trading fees.
 */
export interface TriangularOpportunity {
  id: string;
  exchange: ExchangeId;
  direction: "forward" | "reverse";
  /** Asset path, e.g. ["USDT","BTC","ETH","USDT"]. */
  path: string[];
  legs: TriangularLeg[];
  startAmount: number;
  endAmount: number;
  grossProfit: number;
  netProfit: number;
  netProfitPct: number;
  actionable: boolean;
  reason?: string;
  detectedAt: number;
}

export interface TriangularConfig {
  exchange: ExchangeId;
  /** Display pairs in cycle order, e.g. ["BTC/USDT","ETH/BTC","ETH/USDT"]. */
  pairs: string[];
  notionalUsd: number;
}

/** End-to-end latency breakdown for a single detection. */
export interface LatencySample {
  /** receivedAt - exchangeTime (network + exchange). Null if no exchange ts. */
  feedMs: number | null;
  /** detectedAt - receivedAt (our processing). The number we own. */
  processingMs: number;
}

/** Fill state of a single order leg (buy or sell). */
export type OrderLegState = "filled" | "partial" | "rejected";

/**
 * How a directional residual (one leg filled more than the other) was brought
 * back to flat:
 * - `none`: legs matched, no residual.
 * - `rehedged`: completed the missing leg (traded the residual on the intended
 *   counter-venue) — captures the arb intent at a worse/uncertain price.
 * - `unwound`: reversed the filled leg (traded the residual back on the venue we
 *   just hit) — gives up the arb to return to flat.
 * The engine picks whichever is cheaper, always prioritizing flat.
 */
export type ResidualResolution = "none" | "rehedged" | "unwound";

/** One order leg of an execution, with its own fill state (state machine). */
export interface TradeLeg {
  side: OrderSide;
  exchange: ExchangeId;
  requestedSize: number;
  filledSize: number;
  avgPrice: number;
  state: OrderLegState;
}

/** Exact balance change applied to one wallet by an execution. */
export interface WalletDelta {
  exchange: ExchangeId;
  usd: number;
  btc: number;
}

/** Result of a (partially) filled simulated arbitrage execution. */
export interface SimulatedTrade {
  id: string;
  opportunityId: string;
  symbol: string;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  /** Matched size (base asset) — the portion cleanly arbitraged (both legs). */
  filledSize: number;
  requestedSize: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  fees: number;
  netProfit: number;
  partial: boolean;
  executedAt: number;
  /** Buy/sell legs modeled as an independent state machine each. */
  buyLeg: TradeLeg;
  sellLeg: TradeLeg;
  /** Signed BTC residual (buyFilled − sellFilled) before resolution. */
  residualBtc: number;
  /** How the residual was brought back to flat (if any). */
  resolution: ResidualResolution;
  /** P&L of the residual resolution (quote currency) — usually ≤ 0. */
  resolutionPnlUsd: number;
  /** Directional state after resolution (`flat` unless nothing could be done). */
  finalState: "flat" | "exposed";
  /** Exact per-wallet balance deltas (both legs + resolution). */
  walletDeltas: WalletDelta[];
  /** Which adverse conditions hit this execution (e.g. "reject:sell","gap"). */
  scenarioTags: string[];
}

/** Simulated wallet balances on a single exchange. */
export interface WalletBalance {
  exchange: ExchangeId;
  usd: number;
  btc: number;
}

/**
 * Per-venue inventory state for the (s,S) rebalancing policy: a target
 * (order-up-to level), a deadband [floor, ceiling] around it, and current
 * balances. No action is taken while BTC stays inside the band; crossing a
 * limit triggers a transfer back to target — the classic anti-thrashing (s,S).
 */
export interface VenueInventory {
  exchange: ExchangeId;
  usd: number;
  btc: number;
  /** Order-up-to level (transfers return here) — the starting baseline. */
  targetBtc: number;
  /** Lower deadband edge (target − band). Below this, the venue pulls BTC in. */
  floorBtc: number;
  /** Upper deadband edge (target + band). Above this, the venue sends BTC out. */
  ceilingBtc: number;
  /** Estimated max-size trades this venue can still support (binding leg). */
  capacityTrades: number;
  /**
   * Signed EWMA of BTC change per trade (the venue's inventory drift velocity).
   * Positive = accumulating BTC (drifting toward the ceiling), negative =
   * bleeding BTC (toward the floor). A transparent forecast, not a promise.
   */
  driftPerTradeBtc: number;
  /**
   * Forecast: trades until the current drift carries this venue across its
   * nearest deadband edge (triggering a rebalance). Null when drift is
   * negligible, data is too thin, or the horizon is far off — i.e. "stable".
   */
  projectedTradesToBreach: number | null;
}

/** A single on-chain inventory-rebalancing transfer (for the timeline). */
export interface RebalanceEvent {
  ts: number;
  fromExchange: ExchangeId;
  toExchange: ExchangeId;
  amountBtc: number;
  costUsd: number;
}

/** Aggregate performance snapshot. */
export interface PortfolioStats {
  startingEquityUsd: number;
  currentEquityUsd: number;
  realizedPnlUsd: number;
  totalTrades: number;
  totalOpportunities: number;
  actionableOpportunities: number;
  winRate: number;
  wallets: WalletBalance[];
  /** Per-venue (s,S) inventory state for the wallets panel. */
  inventory: VenueInventory[];
  /** Equity curve points for charting. */
  equityCurve: EquityPoint[];
  /** Inventory-rebalancing accounting (amortized withdrawal-fee model). */
  rebalancing: RebalancingStats;
  /** Live circuit-breaker / loss-limit state (halted? which venues benched?). */
  riskState: RiskState;
}

/**
 * Withdrawal fees are a rebalancing cost, not a per-trade cost: the inventory
 * model only pays them when accumulated drift forces an on-chain transfer
 * between venues. We track the total and amortize it across executed trades.
 */
export interface RebalancingStats {
  /** Number of on-chain rebalancing transfers triggered so far. */
  events: number;
  /** Total withdrawal-fee cost incurred (quote currency). */
  totalCostUsd: number;
  /** totalCostUsd / trades — the honest per-trade drag from withdrawals. */
  amortizedCostPerTradeUsd: number;
  /** Deadband half-width (BTC): the (s,S) trigger distance from target. */
  bandBtc: number;
  /** Most recent transfers, newest first (for the wallets timeline). */
  recentEvents: RebalanceEvent[];
}

export interface EquityPoint {
  t: number;
  equity: number;
}

/** Rolling latency stats surfaced to the dashboard. */
export interface LatencyStats {
  processing: PercentileStats;
  feed: PercentileStats;
  /** Per-exchange age of last update (ms ago). */
  feedAgeMs: Partial<Record<ExchangeId, number>>;
}

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

/**
 * How the engine decides an opportunity is actionable:
 * - `ev`: fire only when expected value > minimum (anticipatory; the default).
 * - `spread`: fire on a positive net spread that clears the risk gate (naive
 *   threshold). Exposed so a judge can flip live and see EV's value.
 */
export type DecisionMode = "ev" | "spread";

/**
 * Adverse-scenario injector ("chaos mode") — a clearly-labeled way to stress the
 * execution path so a judge can *trigger* a failure and watch the bot recover to
 * flat, rather than just read that it can. All zero = inactive (normal
 * execution). Applied only inside the execution simulator; never touches
 * detection latency or the live feeds. Like demo mode, it is honest by design.
 */
export interface ScenarioConfig {
  /** Probability [0..1] that a given order leg is rejected outright (0 fill). */
  rejectProb: number;
  /** Fraction [0..1] to shrink available order-book depth (liquidity crunch). */
  liquidityHaircutPct: number;
  /** Adverse price move (bps) applied mid-execution (buy up / sell down). */
  priceGapBps: number;
  /**
   * Venues force-"downed" by the judge to simulate an exchange going dark: the
   * engine freezes their feed (stops ingesting new books), so they age out, the
   * stale-quote guard stops trading them, and the dashboard shows them down —
   * the "tirar un exchange" adverse event. Empty = all venues live.
   */
  downedVenues: ExchangeId[];
}

/**
 * Runtime risk limits — automated controls that HALT or BENCH trading when
 * things go wrong, on top of the per-trade risk gate. These are the "circuit
 * breaker + exposure limits" a real desk runs, and they're triggerable live via
 * the adverse-scenario injector so a judge can watch them act.
 */
export interface RiskLimitsConfig {
  /**
   * Per-venue circuit breaker: number of leg rejections on a single venue,
   * within `breakerWindowMs`, that trips it — benching that venue from
   * execution for `breakerCooldownMs` before it auto-recovers. 0 disables.
   */
  breakerRejects: number;
  /** Rolling window (ms) over which a venue's rejections are counted. */
  breakerWindowMs: number;
  /** How long a tripped venue stays benched before auto-recovery (ms). */
  breakerCooldownMs: number;
  /**
   * Session loss limit (kill-switch): when realized P&L falls to or below
   * −`maxSessionLossUsd`, ALL execution halts (detection keeps running) until
   * the session is reset. 0 disables. The global drawdown breaker.
   */
  maxSessionLossUsd: number;
}

/** Live runtime state of the risk governor, surfaced for the dashboard. */
export interface RiskState {
  /** True when the session loss limit tripped and execution is halted. */
  halted: boolean;
  /** Why trading is halted (human-readable), when `halted`. */
  haltReason?: string;
  /** Venues currently benched by the per-venue circuit breaker. */
  benched: ExchangeId[];
}

/** Tunable Filo (chat copilot) behaviour, echoed to the dashboard. */
export interface FiloConfig {
  /** Period of Filo's unprompted session digest (ms); 0 disables the digest. */
  digestMs: number;
  /** Whether Filo posts unprompted narrations at all (answers are unaffected). */
  narrate: boolean;
}

/** Engine configuration echoed to the dashboard. */
export interface EngineConfig {
  symbol: string;
  /** Epoch ms when the server process booted — drives the "live since" label. */
  startedAt: number;
  exchanges: ExchangeId[];
  maxNotionalUsd: number;
  minNetProfitUsd: number;
  maxSaneSpreadPct: number;
  maxQuoteAgeMs: number;
  /**
   * Feed-dislocation guard: max fraction a venue's mid may deviate from the
   * cross-venue consensus (median) before it's treated as a lagging/bad feed and
   * excluded from arbitrage. Robust to event-loop stalls where quotes look fresh
   * but are stale. 0 disables the guard.
   */
  maxVenueDeviationPct: number;
  /** Whether the synthetic demo/replay injector is currently active. */
  demoMode: boolean;
  /** Venues on which triangular arbitrage is monitored (empty if disabled). */
  triangular: TriangularConfig[];
  /** Expected-value model parameters (echoed for dashboard transparency). */
  ev: EvConfig;
  /** Active decision rule (EV vs naive spread threshold). */
  decisionMode: DecisionMode;
  /** Filo chat copilot behaviour. */
  filo: FiloConfig;
  /** Inventory drift (BTC) a venue may accumulate before an on-chain rebalance. */
  rebalanceThresholdBtc: number;
  /** Per-exchange trading-cost schedule (taker/maker + withdrawal), live-tunable. */
  fees: Record<ExchangeId, FeeModel>;
  /** Whether the passive leg is assumed taker (default) or maker (see `FeeMode`). */
  feeMode: FeeMode;
  /**
   * Venues currently EXCLUDED from cross-exchange comparison (their feeds keep
   * streaming, but no opportunity/trade will involve them). Empty = all active.
   */
  disabledExchanges: ExchangeId[];
  /** Adverse-scenario injector state (all zero/empty = inactive). */
  scenario: ScenarioConfig;
  /** Automated circuit-breaker / loss-limit controls. */
  riskLimits: RiskLimitsConfig;
  /**
   * Whether the market REPLAY injector is active. Replay streams a recorded
   * window of REAL market data (captured live) back through the engine at
   * `replaySpeed`, giving a reproducible, judge-controllable demo when the live
   * market is quiet. Clearly labeled, like demo mode. Mutually exclusive with
   * demo mode.
   */
  replayMode: boolean;
  /** Replay playback rate multiplier (e.g. 1 = real time, 4 = 4×). */
  replaySpeed: number;
}

/**
 * Live-tunable subset of the engine config, sent from the dashboard. Every
 * field is optional; the server clamps values to safe ranges before applying.
 */
export interface EngineConfigPatch {
  decisionMode?: DecisionMode;
  minNetProfitUsd?: number;
  ev?: Partial<EvConfig>;
  filo?: Partial<FiloConfig>;
  /** Max notional (USD) sized per simulated leg. */
  maxNotionalUsd?: number;
  /** Data-glitch guard: reject crosses wider than this fraction (e.g. 0.05). */
  maxSaneSpreadPct?: number;
  /** Stale-feed guard: reject quotes older than this (ms). */
  maxQuoteAgeMs?: number;
  /** Feed-dislocation guard: max mid deviation from cross-venue consensus. */
  maxVenueDeviationPct?: number;
  /** Inventory drift (BTC) that triggers an on-chain rebalance. */
  rebalanceThresholdBtc?: number;
  /** Partial per-exchange fee overrides (taker/maker fraction / withdrawal BTC). */
  fees?: Partial<Record<ExchangeId, Partial<FeeModel>>>;
  /** Assume the passive leg is taker or maker. */
  feeMode?: FeeMode;
  /** Full replacement list of venues excluded from comparison. */
  disabledExchanges?: ExchangeId[];
  /** Adverse-scenario injector overrides (partial). */
  scenario?: Partial<ScenarioConfig>;
  /** Circuit-breaker / loss-limit overrides (partial). */
  riskLimits?: Partial<RiskLimitsConfig>;
  /** Replay playback rate multiplier (live-tunable while replaying). */
  replaySpeed?: number;
}

/** Parameters of the transparent expected-value / survival-probability model. */
export interface EvConfig {
  /** Latency decay constant (ms): survival ≈ exp(−age / tauMs). */
  tauMs: number;
  /** Adverse-selection cost (bps of notional) charged if the edge collapses. */
  adverseBps: number;
  /** Minimum expected value (quote currency) required to fire. */
  minEvUsd: number;
}

/* ── Statistical analysis (computed over the full session population) ─────── */

/** A labeled count bucket for a histogram. */
export interface HistogramBucket {
  /** Inclusive lower edge of the bucket (in the metric's unit). */
  from: number;
  /** Exclusive upper edge, or null for the open-ended top bucket. */
  to: number | null;
  /** Human label, e.g. "5–10 bps". */
  label: string;
  count: number;
}

/** How often a venue is the cheap (buy) or expensive (sell) side of a cross. */
export interface VenueActivity {
  exchange: ExchangeId;
  asBuy: number;
  asSell: number;
}

/**
 * Empirical statistics computed server-side over the FULL population of detected
 * crosses (not the small client buffer), so the analysis reflects real data.
 */
export interface StatsSnapshot {
  generatedAt: number;
  /** Number of crosses aggregated since boot. */
  sampleCount: number;
  /** Seconds the engine has been collecting. */
  uptimeSec: number;
  opportunities: {
    total: number;
    actionable: number;
    actionableRatePct: number;
    perMinute: number;
  };
  /** Gross spread distribution, in basis points of notional. */
  grossBps: {
    mean: number;
    p50: number;
    p95: number;
    max: number;
    histogram: HistogramBucket[];
  };
  /** Net (after fees + slippage) spread distribution, in bps — mostly negative. */
  netBps: {
    mean: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
    histogram: HistogramBucket[];
  };
  /** Mean survival probability across detected crosses [0..1]. */
  meanSurvival: number;
  /** Per-venue cheap/expensive-side frequency. */
  venues: VenueActivity[];
}

/* ── Filo conversational agent ───────────────────────────────────────────── */

/** Languages Filo can speak. Mirrors the dashboard's i18n toggle. */
export type FiloLang = "es" | "en";

/**
 * A message in the Filo chat. `text` is bilingual when produced by the
 * deterministic narrator (both languages filled); LLM answers fill only the
 * asked language and the UI falls back to the other if needed.
 */
export interface FiloMessage {
  id: string;
  /** Who sent it. `user` messages are added client-side; server emits `filo`. */
  role: "filo" | "user";
  /** Narrated update vs. a reply to a question vs. the opening greeting. */
  kind: "update" | "answer" | "greeting";
  /** Bilingual copy; at least one language is present. */
  text: Partial<Record<FiloLang, string>>;
  /** Optional tone for styling (profit/loss/neutral cues). */
  tone?: "info" | "good" | "warn" | "bad";
  /** True when the reply came from the optional LLM layer (vs. deterministic). */
  ai?: boolean;
  ts: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface FeedStatus {
  exchange: ExchangeId;
  status: ConnectionStatus;
  lastUpdate: number | null;
  /**
   * Deviation of this venue's mid from the cross-venue consensus (median), in
   * basis points. `null` when consensus can't be formed (quorum < 3 fresh
   * venues) or the venue has no usable book yet. The demo venue is intentionally
   * dislocated and reports `null`.
   */
  deviationBps?: number | null;
  /** True when the venue's latest quote is older than `maxQuoteAgeMs`. */
  stale?: boolean;
  /**
   * True when the consensus guard has quarantined this venue — its mid is beyond
   * `maxVenueDeviationPct` from consensus, so it's excluded from arbitrage until
   * it rejoins. This is the "flaky-host / dislocated feed" defense made visible.
   */
  dislocated?: boolean;
  /**
   * True when this venue is benched by the per-venue circuit breaker (too many
   * leg rejections in the window) — excluded from execution until cooldown.
   */
  benched?: boolean;
  /**
   * True when the venue was force-"downed" via the adverse-scenario injector
   * (its feed is frozen to simulate an exchange going dark).
   */
  downed?: boolean;
}

/* ── Socket.IO event contracts ──────────────────────────────────────────── */

export interface ServerToClientEvents {
  config: (config: EngineConfig) => void;
  book: (book: TopOfBook) => void;
  opportunity: (opp: Opportunity) => void;
  triangular: (opp: TriangularOpportunity) => void;
  trade: (trade: SimulatedTrade) => void;
  portfolio: (stats: PortfolioStats) => void;
  latency: (stats: LatencyStats) => void;
  feeds: (feeds: FeedStatus[]) => void;
  stats: (stats: StatsSnapshot) => void;
  /** A message from Filo: a narrated update, a greeting, or a reply. */
  filo: (msg: FiloMessage) => void;
  /** Session metrics were reset; clients should clear their local feeds. */
  reset: () => void;
}

export interface ClientToServerEvents {
  /** Ask the server to replay current state on connect. */
  sync: () => void;
  /** Toggle the clearly-labeled synthetic demo injector on or off. */
  setDemo: (enabled: boolean) => void;
  /** Toggle the market REPLAY injector (recorded real data) on or off. */
  setReplay: (enabled: boolean) => void;
  /** Ask Filo a free-form question; the answer comes back as a `filo` event. */
  filoAsk: (payload: { id: string; text: string; lang: FiloLang }) => void;
  /** Live-tune engine + Filo settings; server echoes the new `config`. */
  updateConfig: (patch: EngineConfigPatch) => void;
  /** Reset session metrics (P&L, trades, opportunities, equity curve). */
  resetSession: () => void;
}
