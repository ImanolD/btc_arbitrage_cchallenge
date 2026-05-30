import type WebSocket from "ws";
import type { BookLevel, ExchangeId, QuoteAsset } from "@arb/shared";
import { BaseConnector } from "./base.js";
import { parsePair, quoteAssetOf } from "./symbols.js";

interface BitstampData {
  timestamp?: string;
  microtimestamp?: string;
  bids?: string[][];
  asks?: string[][];
}

interface BitstampMessage {
  event?: string;
  channel?: string;
  data?: BitstampData;
}

const DEPTH = 50;

/**
 * Bitstamp public `order_book_{pair}` channel — pushes a full top-100 snapshot
 * on every change, so no local book maintenance is needed. Bitstamp is quoted
 * in USD, so the engine groups it apart from the USDT venues.
 * Docs: https://www.bitstamp.net/websocket/v2/
 */
export class BitstampConnector extends BaseConnector {
  readonly id: ExchangeId = "bitstamp";
  protected readonly url = "wss://ws.bitstamp.net";

  private readonly channel: string;
  private readonly quote: QuoteAsset;

  constructor(symbol: string) {
    super(symbol);
    this.channel = `order_book_${mapSymbol(symbol)}`;
    this.quote = quoteAssetOf(symbol);
  }

  protected onOpen(): void {
    this.send({ event: "bts:subscribe", data: { channel: this.channel } });
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const msg = JSON.parse(raw.toString()) as BitstampMessage;
    // Bitstamp asks us to reconnect periodically to rebalance their servers.
    if (msg.event === "bts:request_reconnect") {
      this.ws?.close();
      return;
    }
    if (msg.event !== "data" || !msg.data) return;

    const bids = toLevels(msg.data.bids);
    const asks = toLevels(msg.data.asks);
    if (bids.length === 0 || asks.length === 0) return;

    const microts = msg.data.microtimestamp ? Number(msg.data.microtimestamp) : NaN;

    this.emitBook({
      exchange: this.id,
      symbol: this.symbol,
      quote: this.quote,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      exchangeTime: Number.isFinite(microts) ? Math.floor(microts / 1000) : null,
      receivedAt,
    });
  }
}

function toLevels(raw: string[][] | undefined): BookLevel[] {
  if (!raw) return [];
  const out: BookLevel[] = [];
  for (const level of raw.slice(0, DEPTH)) {
    const p = Number(level[0]);
    const q = Number(level[1]);
    if (q > 0) out.push([p, q] as BookLevel);
  }
  return out;
}

function mapSymbol(symbol: string): string {
  const { base, quote } = parsePair(symbol);
  return `${base}${quote}`.toLowerCase();
}
