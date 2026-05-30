import type WebSocket from "ws";
import type { BookLevel, ExchangeId, QuoteAsset } from "@arb/shared";
import { BaseConnector } from "./base.js";
import { parsePair, quoteAssetOf } from "./symbols.js";

interface KrakenLevel {
  price: number;
  qty: number;
}

interface KrakenBookData {
  symbol: string;
  bids: KrakenLevel[];
  asks: KrakenLevel[];
  timestamp?: string;
}

interface KrakenMessage {
  channel?: string;
  type?: "snapshot" | "update";
  data?: KrakenBookData[];
}

const DEPTH = 25;

/**
 * Kraken WebSocket v2 `book` channel. Kraken streams a snapshot then deltas, so
 * we maintain a local book (price -> qty maps) and re-derive the top N on each
 * update. Updates carry an ISO `timestamp`, which we use for feed latency.
 * Docs: https://docs.kraken.com/api/docs/websocket-v2/book
 */
export class KrakenConnector extends BaseConnector {
  readonly id: ExchangeId = "kraken";
  protected readonly url = "wss://ws.kraken.com/v2";

  private readonly krakenSymbol: string;
  private readonly quote: QuoteAsset;
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();

  constructor(symbol: string) {
    super(symbol);
    this.krakenSymbol = mapSymbol(symbol);
    this.quote = quoteAssetOf(symbol);
  }

  protected onOpen(): void {
    this.bids.clear();
    this.asks.clear();
    this.send({
      method: "subscribe",
      params: { channel: "book", symbol: [this.krakenSymbol], depth: DEPTH },
    });
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const msg = JSON.parse(raw.toString()) as KrakenMessage;
    if (msg.channel !== "book" || !msg.data || msg.data.length === 0) return;

    const data = msg.data[0];
    if (msg.type === "snapshot") {
      this.bids.clear();
      this.asks.clear();
    }
    applyLevels(this.bids, data.bids);
    applyLevels(this.asks, data.asks);

    const bids = topLevels(this.bids, "desc");
    const asks = topLevels(this.asks, "asc");
    if (bids.length === 0 || asks.length === 0) return;

    const exchangeTime = data.timestamp ? Date.parse(data.timestamp) : null;

    this.emitBook({
      exchange: this.id,
      symbol: this.symbol,
      quote: this.quote,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      exchangeTime: Number.isNaN(exchangeTime) ? null : exchangeTime,
      receivedAt,
    });
  }
}

function applyLevels(side: Map<number, number>, levels: KrakenLevel[]): void {
  for (const { price, qty } of levels) {
    if (qty === 0) side.delete(price);
    else side.set(price, qty);
  }
}

function topLevels(side: Map<number, number>, dir: "asc" | "desc"): BookLevel[] {
  const entries = [...side.entries()].sort((a, b) =>
    dir === "asc" ? a[0] - b[0] : b[0] - a[0],
  );
  return entries.slice(0, DEPTH).map(([p, q]) => [p, q] as BookLevel);
}

/** Map the generic engine symbol (e.g. BTCUSDT) to Kraken's `BASE/QUOTE`. */
function mapSymbol(symbol: string): string {
  const { base, quote } = parsePair(symbol);
  return `${base}/${quote}`;
}
