import type WebSocket from "ws";
import type { BookLevel, ExchangeId } from "@arb/shared";
import { BaseConnector } from "./base.js";

interface OkxBookData {
  asks: string[][];
  bids: string[][];
  ts: string;
}

interface OkxMessage {
  event?: string;
  arg?: { channel: string; instId: string };
  data?: OkxBookData[];
}

/**
 * OKX v5 public `books5` channel — pushes a full top-5 snapshot on every
 * change, so no local book maintenance is required. Carries an exchange `ts`.
 * Docs: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-ws-order-book-channel
 */
export class OkxConnector extends BaseConnector {
  readonly id: ExchangeId = "okx";
  protected readonly url = "wss://ws.okx.com:8443/ws/v5/public";

  private readonly instId: string;

  constructor(symbol: string) {
    super(symbol);
    this.instId = mapSymbol(symbol);
  }

  protected onOpen(): void {
    this.send({
      op: "subscribe",
      args: [{ channel: "books5", instId: this.instId }],
    });
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const text = raw.toString();
    if (text === "pong") return;

    const msg = JSON.parse(text) as OkxMessage;
    if (msg.event || !msg.data || msg.data.length === 0) return;

    const data = msg.data[0];
    const bids = toLevels(data.bids);
    const asks = toLevels(data.asks);
    if (bids.length === 0 || asks.length === 0) return;

    const exchangeTime = data.ts ? Number(data.ts) : null;

    this.emitBook({
      exchange: this.id,
      symbol: this.symbol,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      exchangeTime: exchangeTime && Number.isFinite(exchangeTime) ? exchangeTime : null,
      receivedAt,
    });
  }
}

function toLevels(raw: string[][]): BookLevel[] {
  const out: BookLevel[] = [];
  for (const level of raw) {
    const p = Number(level[0]);
    const q = Number(level[1]);
    if (q > 0) out.push([p, q] as BookLevel);
  }
  return out;
}

function mapSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT")) return `${s.slice(0, -4)}-USDT`;
  if (s.endsWith("USD")) return `${s.slice(0, -3)}-USD`;
  return s;
}
