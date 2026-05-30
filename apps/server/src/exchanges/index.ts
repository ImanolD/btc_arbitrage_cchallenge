import type { ExchangeId } from "@arb/shared";
import type { BaseConnector } from "./base.js";
import { BinanceConnector } from "./binance.js";
import { KrakenConnector } from "./kraken.js";
import { OkxConnector } from "./okx.js";
import { BybitConnector } from "./bybit.js";
import { KucoinConnector } from "./kucoin.js";
import { GateConnector } from "./gate.js";
import { BitstampConnector } from "./bitstamp.js";
import { BitfinexConnector } from "./bitfinex.js";
import { parsePair } from "./symbols.js";

type ConnectorFactory = (symbol: string) => BaseConnector;

const registry: Partial<Record<ExchangeId, ConnectorFactory>> = {
  binance: (symbol) => new BinanceConnector(symbol),
  kraken: (symbol) => new KrakenConnector(symbol),
  okx: (symbol) => new OkxConnector(symbol),
  bybit: (symbol) => new BybitConnector(symbol),
  kucoin: (symbol) => new KucoinConnector(symbol),
  gate: (symbol) => new GateConnector(symbol),
  bitstamp: (symbol) => new BitstampConnector(symbol),
  bitfinex: (symbol) => new BitfinexConnector(symbol),
};

/**
 * Venues whose primary BTC market is USD-quoted rather than USDT. The engine
 * groups books by quote currency, so these participate in their own USD pool.
 */
const USD_VENUES = new Set<ExchangeId>(["bitstamp", "bitfinex", "coinbase"]);

/** Resolve the per-venue symbol from the generic engine symbol (e.g. swap the
 * USDT quote for USD on USD-native venues). */
export function symbolForExchange(id: ExchangeId, symbol: string): string {
  if (USD_VENUES.has(id)) {
    return `${parsePair(symbol).base}USD`;
  }
  return symbol;
}

export function createConnector(
  id: ExchangeId,
  symbol: string,
): BaseConnector | null {
  const factory = registry[id];
  if (!factory) {
    console.warn(`[connectors] no connector registered for "${id}", skipping`);
    return null;
  }
  return factory(symbolForExchange(id, symbol));
}

export function createConnectors(
  exchanges: ExchangeId[],
  symbol: string,
): BaseConnector[] {
  const connectors: BaseConnector[] = [];
  for (const id of exchanges) {
    const connector = createConnector(id, symbol);
    if (connector) connectors.push(connector);
  }
  return connectors;
}

export { BaseConnector } from "./base.js";
