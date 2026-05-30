import type WebSocket from "ws";
import type { BookLevel, ExchangeId, QuoteAsset, TopOfBook } from "@arb/shared";
import { BaseConnector } from "./base.js";
import { quoteAssetOf } from "./symbols.js";

interface BinanceDepthMessage {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

/**
 * Binance partial book depth stream (top 20 levels, pushed every 100ms).
 * Docs: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
 */
export class BinanceConnector extends BaseConnector {
  readonly id: ExchangeId = "binance";
  protected readonly url: string;
  private readonly quote: QuoteAsset;

  constructor(symbol: string) {
    super(symbol);
    this.quote = quoteAssetOf(symbol);
    const stream = `${symbol.toLowerCase().replace(/[-_/]/g, "")}@depth20@100ms`;
    this.url = `wss://stream.binance.com:9443/ws/${stream}`;
  }

  protected onOpen(): void {
    // Stream is in the URL; no subscribe message required.
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const msg = JSON.parse(raw.toString()) as BinanceDepthMessage;
    if (!msg.bids || !msg.asks) return;

    const bids = toLevels(msg.bids);
    const asks = toLevels(msg.asks);
    if (bids.length === 0 || asks.length === 0) return;

    const book: TopOfBook = {
      exchange: this.id,
      symbol: this.symbol,
      quote: this.quote,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      // Partial-depth stream carries no event time; processing latency is what
      // we measure and own. (The diff-depth stream exposes `E` if needed.)
      exchangeTime: null,
      receivedAt,
    };
    this.emitBook(book);
  }
}

function toLevels(raw: [string, string][]): BookLevel[] {
  const out: BookLevel[] = [];
  for (const [price, qty] of raw) {
    const p = Number(price);
    const q = Number(qty);
    if (q > 0) out.push([p, q] as BookLevel);
  }
  return out;
}
