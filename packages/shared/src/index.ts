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

/** Result of a (partially) filled simulated arbitrage execution. */
export interface SimulatedTrade {
  id: string;
  opportunityId: string;
  symbol: string;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  /** Size actually filled (base asset). May be < requested under low liquidity. */
  filledSize: number;
  requestedSize: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  fees: number;
  netProfit: number;
  partial: boolean;
  executedAt: number;
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

/** Engine configuration echoed to the dashboard. */
export interface EngineConfig {
  symbol: string;
  exchanges: ExchangeId[];
  maxNotionalUsd: number;
  minNetProfitUsd: number;
  maxSaneSpreadPct: number;
  maxQuoteAgeMs: number;
  /** Whether the synthetic demo/replay injector is currently active. */
  demoMode: boolean;
  /** Venues on which triangular arbitrage is monitored (empty if disabled). */
  triangular: TriangularConfig[];
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
}

export interface ClientToServerEvents {
  /** Ask the server to replay current state on connect. */
  sync: () => void;
  /** Toggle the clearly-labeled demo/replay injector on or off. */
  setDemo: (enabled: boolean) => void;
}
