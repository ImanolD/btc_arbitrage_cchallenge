import "dotenv/config";
import type { EngineConfig, ExchangeId, FeeModel } from "@arb/shared";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const PORT = num("PORT", 4000);

const enabledExchanges = (
  process.env.EXCHANGES ?? "binance,kraken,okx,bybit,kucoin,gate,bitstamp,bitfinex"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean) as ExchangeId[];

export const SYMBOL = process.env.SYMBOL ?? "BTCUSDT";

export const DEMO_MODE_DEFAULT = (process.env.DEMO_MODE ?? "false") === "true";

/**
 * Triangular arbitrage runs independently on each listed venue across the cycle
 * BTC/USDT · ETH/BTC · ETH/USDT. Each venue gets its own three connectors, so
 * any single-exchange venue with these three liquid pairs qualifies.
 */
export const TRIANGULAR_EXCHANGES = (
  process.env.TRIANGULAR_EXCHANGES ?? "binance,okx,bybit,kucoin,gate"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean) as ExchangeId[];

export const TRIANGULAR_NOTIONAL_USD = num("TRIANGULAR_NOTIONAL_USD", 10_000);

/** Display pairs (cycle order) and the generic stream symbols each connector
 * maps to its own convention. Shared across all triangular venues. */
export const TRIANGULAR_PAIRS = ["BTC/USDT", "ETH/BTC", "ETH/USDT"];
export const TRIANGULAR_SYMBOLS = {
  btcQuote: "BTCUSDT",
  interBase: "ETHBTC",
  interQuote: "ETHUSDT",
};

export const engineConfig: EngineConfig = {
  symbol: SYMBOL,
  exchanges: enabledExchanges,
  maxNotionalUsd: num("MAX_NOTIONAL_USD", 50_000),
  minNetProfitUsd: num("MIN_NET_PROFIT_USD", 1),
  maxSaneSpreadPct: num("MAX_SANE_SPREAD_PCT", 0.05),
  maxQuoteAgeMs: num("MAX_QUOTE_AGE_MS", 2_000),
  demoMode: DEMO_MODE_DEFAULT,
  triangular: TRIANGULAR_EXCHANGES.map((exchange) => ({
    exchange,
    pairs: TRIANGULAR_PAIRS,
    notionalUsd: TRIANGULAR_NOTIONAL_USD,
  })),
};

export const startingBalances = {
  usdPerExchange: num("START_USD_PER_EXCHANGE", 100_000),
  btcPerExchange: num("START_BTC_PER_EXCHANGE", 2),
};

/**
 * Published taker-fee schedules (approximate, spot, no VIP tiers). Withdrawal
 * fees are listed for completeness but the engine uses the inventory model by
 * default (capital pre-positioned on both venues), so per-trade withdrawals are
 * not charged — see docs/ARCHITECTURE.md for the reasoning.
 */
export const feeModels: Record<ExchangeId, FeeModel> = {
  binance: { takerFee: 0.001, withdrawalFeeBtc: 0.0002 },
  kraken: { takerFee: 0.0026, withdrawalFeeBtc: 0.00015 },
  coinbase: { takerFee: 0.006, withdrawalFeeBtc: 0.0 },
  okx: { takerFee: 0.001, withdrawalFeeBtc: 0.0002 },
  bybit: { takerFee: 0.001, withdrawalFeeBtc: 0.0002 },
  kucoin: { takerFee: 0.001, withdrawalFeeBtc: 0.0005 },
  gate: { takerFee: 0.002, withdrawalFeeBtc: 0.001 },
  bitstamp: { takerFee: 0.003, withdrawalFeeBtc: 0.0 },
  bitfinex: { takerFee: 0.002, withdrawalFeeBtc: 0.0004 },
  demo: { takerFee: 0.001, withdrawalFeeBtc: 0.0002 },
};
