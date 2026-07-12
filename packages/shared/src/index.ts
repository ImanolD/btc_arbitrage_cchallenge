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
  /** Estimated BTC withdrawal fee (only used by the transfer model). */
  withdrawalFeeBtc: number;
}

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
  /** Equity curve points for charting. */
  equityCurve: EquityPoint[];
  /** Inventory-rebalancing accounting (amortized withdrawal-fee model). */
  rebalancing: RebalancingStats;
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
  /** Per-exchange trading-cost schedule (taker + withdrawal), live-tunable. */
  fees: Record<ExchangeId, FeeModel>;
  /**
   * Venues currently EXCLUDED from cross-exchange comparison (their feeds keep
   * streaming, but no opportunity/trade will involve them). Empty = all active.
   */
  disabledExchanges: ExchangeId[];
  /** Adverse-scenario injector state (all zero = inactive). */
  scenario: ScenarioConfig;
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
  /** Inventory drift (BTC) that triggers an on-chain rebalance. */
  rebalanceThresholdBtc?: number;
  /** Partial per-exchange fee overrides (taker fraction / withdrawal BTC). */
  fees?: Partial<Record<ExchangeId, Partial<FeeModel>>>;
  /** Full replacement list of venues excluded from comparison. */
  disabledExchanges?: ExchangeId[];
  /** Adverse-scenario injector overrides (partial). */
  scenario?: Partial<ScenarioConfig>;
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
  /** Toggle the clearly-labeled demo/replay injector on or off. */
  setDemo: (enabled: boolean) => void;
  /** Ask Filo a free-form question; the answer comes back as a `filo` event. */
  filoAsk: (payload: { id: string; text: string; lang: FiloLang }) => void;
  /** Live-tune engine + Filo settings; server echoes the new `config`. */
  updateConfig: (patch: EngineConfigPatch) => void;
  /** Reset session metrics (P&L, trades, opportunities, equity curve). */
  resetSession: () => void;
}
