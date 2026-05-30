import type { ExchangeId } from "@arb/shared";
import type { BaseConnector } from "./base.js";
import { BinanceConnector } from "./binance.js";
import { KrakenConnector } from "./kraken.js";
import { OkxConnector } from "./okx.js";
import { BybitConnector } from "./bybit.js";

type ConnectorFactory = (symbol: string) => BaseConnector;

const registry: Partial<Record<ExchangeId, ConnectorFactory>> = {
  binance: (symbol) => new BinanceConnector(symbol),
  kraken: (symbol) => new KrakenConnector(symbol),
  okx: (symbol) => new OkxConnector(symbol),
  bybit: (symbol) => new BybitConnector(symbol),
};

export function createConnectors(
  exchanges: ExchangeId[],
  symbol: string,
): BaseConnector[] {
  const connectors: BaseConnector[] = [];
  for (const id of exchanges) {
    const factory = registry[id];
    if (!factory) {
      console.warn(`[connectors] no connector registered for "${id}", skipping`);
      continue;
    }
    connectors.push(factory(symbol));
  }
  return connectors;
}

export { BaseConnector } from "./base.js";
