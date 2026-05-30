import type WebSocket from "ws";
import type { BookLevel, ExchangeId } from "@arb/shared";
import { BaseConnector } from "./base.js";

interface BybitBookData {
  s: string;
  b: string[][];
  a: string[][];
}

interface BybitMessage {
  topic?: string;
  type?: "snapshot" | "delta";
  ts?: number;
  data?: BybitBookData;
  op?: string;
}

const DEPTH = 50;

/**
 * Bybit v5 public spot `orderbook.50` channel. Streams a snapshot then deltas
 * (a level with size "0" is a removal), so we maintain a local book like
 * Kraken. Bybit requires a JSON `{op:"ping"}` keepalive, sent via the base
 * heartbeat hook. Top-level `ts` is the exchange event time.
 * Docs: https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
 */
export class BybitConnector extends BaseConnector {
  readonly id: ExchangeId = "bybit";
  protected readonly url = "wss://stream.bybit.com/v5/public/spot";

  private readonly topic: string;
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();

  constructor(symbol: string) {
    super(symbol);
    this.topic = `orderbook.${DEPTH}.${symbol.toUpperCase()}`;
  }

  protected onOpen(): void {
    this.bids.clear();
    this.asks.clear();
    this.send({ op: "subscribe", args: [this.topic] });
  }

  protected override heartbeatPayload(): unknown {
    return { op: "ping" };
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const msg = JSON.parse(raw.toString()) as BybitMessage;
    if (msg.op || !msg.topic || !msg.data) return;

    if (msg.type === "snapshot") {
      this.bids.clear();
      this.asks.clear();
    }
    applyLevels(this.bids, msg.data.b);
    applyLevels(this.asks, msg.data.a);

    const bids = topLevels(this.bids, "desc");
    const asks = topLevels(this.asks, "asc");
    if (bids.length === 0 || asks.length === 0) return;

    this.emitBook({
      exchange: this.id,
      symbol: this.symbol,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      exchangeTime: typeof msg.ts === "number" ? msg.ts : null,
      receivedAt,
    });
  }
}

function applyLevels(side: Map<number, number>, levels: string[][] | undefined): void {
  if (!levels) return;
  for (const [priceStr, sizeStr] of levels) {
    const price = Number(priceStr);
    const size = Number(sizeStr);
    if (size === 0) side.delete(price);
    else side.set(price, size);
  }
}

function topLevels(side: Map<number, number>, dir: "asc" | "desc"): BookLevel[] {
  const entries = [...side.entries()].sort((a, b) =>
    dir === "asc" ? a[0] - b[0] : b[0] - a[0],
  );
  return entries.slice(0, DEPTH).map(([p, q]) => [p, q] as BookLevel);
}
