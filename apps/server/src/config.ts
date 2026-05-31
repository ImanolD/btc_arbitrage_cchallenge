import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { DecisionMode, EngineConfig, ExchangeId, FeeModel } from "@arb/shared";

// Load env from the monorepo root first (where .env lives), then fall back to
// the current working directory. dotenv never overrides already-set vars, so
// real platform env (Railway/Render/etc.) always wins on the live deploy.
const here = path.dirname(fileURLToPath(import.meta.url)); // apps/server/src
loadEnv({ path: path.resolve(here, "../../../.env") }); // repo root
loadEnv();

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
  startedAt: Date.now(),
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
  ev: {
    tauMs: num("EV_TAU_MS", 400),
    adverseBps: num("EV_ADVERSE_BPS", 5),
    minEvUsd: num("EV_MIN_USD", 0),
  },
  decisionMode: (process.env.DECISION_MODE === "spread" ? "spread" : "ev") as DecisionMode,
  filo: {
    digestMs: num("FILO_DIGEST_MS", 75_000),
    narrate: (process.env.FILO_NARRATE ?? "true") !== "false",
  },
};

function str(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : raw;
}

/**
 * Optional persistence + WhatsApp ("Filo by WhatsApp") configuration. Every
 * field is optional: with none set the server runs fully clean-room (in-memory
 * storage, WhatsApp disabled). On our live deploy these are provided. None of
 * this touches the detection/execution hot path — same stance as the LLM layer.
 */
export const integrations = {
  /** MongoDB connection string; falls back to in-memory storage when absent. */
  mongoUri: str("MONGODB_URI"),
  mongoDb: process.env.MONGODB_DB ?? "filobot",
  whatsapp: {
    /** Kapso project API key (X-API-Key). */
    apiKey: str("KAPSO_API_KEY"),
    /** WhatsApp Business phone number id used in the send endpoint path. */
    phoneNumberId: str("KAPSO_PHONE_NUMBER_ID"),
    /** Secret used to verify inbound webhook signatures (HMAC-SHA256). */
    webhookSecret: str("KAPSO_WEBHOOK_SECRET"),
    /** Public display number (E.164, digits only) used for the wa.me link. */
    displayNumber: (str("WHATSAPP_NUMBER") ?? "").replace(/[^0-9]/g, "") || undefined,
    /** Prefilled keyword the visitor sends to opt in via click-to-chat. */
    keyword: process.env.WHATSAPP_KEYWORD ?? "Filo",
    /** Min seconds between unprompted pushes to a single subscriber. */
    minPushIntervalSec: num("WHATSAPP_MIN_PUSH_SEC", 45),
    base: process.env.KAPSO_BASE_URL ?? "https://api.kapso.ai/meta/whatsapp/v24.0",
  },
};

export const startingBalances = {
  usdPerExchange: num("START_USD_PER_EXCHANGE", 100_000),
  btcPerExchange: num("START_BTC_PER_EXCHANGE", 2),
};

/**
 * Inventory drift (BTC) a single venue may accumulate before an on-chain
 * rebalancing transfer is triggered. The withdrawal fee paid on that transfer
 * is the only place per-trade withdrawal costs enter the model (amortized).
 */
export const REBALANCE_THRESHOLD_BTC = num("REBALANCE_THRESHOLD_BTC", 0.5);

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
