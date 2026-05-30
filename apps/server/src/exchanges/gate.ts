import type WebSocket from "ws";
import type { BookLevel, ExchangeId, QuoteAsset } from "@arb/shared";
import { BaseConnector } from "./base.js";
import { parsePair, quoteAssetOf } from "./symbols.js";

interface GateResult {
  t?: number;
  s?: string;
  bids?: string[][];
  asks?: string[][];
}

interface GateMessage {
  channel?: string;
  event?: string;
  result?: GateResult;
}

const LIMIT = "20";

/**
 * Gate.io v4 public `spot.order_book` channel — pushes a full limited-depth
 * snapshot every 100ms, so no local book maintenance is needed. Carries an
 * exchange timestamp `t` (ms).
 * Docs: https://www.gate.io/docs/developers/apiv4/ws/en/#limited-level-full-order-book-snapshot
 */
export class GateConnector extends BaseConnector {
  readonly id: ExchangeId = "gate";
  protected readonly url = "wss://api.gateio.ws/ws/v4/";

  private readonly pair: string;
  private readonly quote: QuoteAsset;

  constructor(symbol: string) {
    super(symbol);
    this.pair = mapSymbol(symbol);
    this.quote = quoteAssetOf(symbol);
  }

  protected onOpen(): void {
    this.send({
      time: Math.floor(Date.now() / 1000),
      channel: "spot.order_book",
      event: "subscribe",
      payload: [this.pair, LIMIT, "100ms"],
    });
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const msg = JSON.parse(raw.toString()) as GateMessage;
    if (msg.channel !== "spot.order_book" || msg.event !== "update" || !msg.result) {
      return;
    }

    const bids = toLevels(msg.result.bids);
    const asks = toLevels(msg.result.asks);
    if (bids.length === 0 || asks.length === 0) return;

    this.emitBook({
      exchange: this.id,
      symbol: this.symbol,
      quote: this.quote,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      exchangeTime: typeof msg.result.t === "number" ? msg.result.t : null,
      receivedAt,
    });
  }
}

function toLevels(raw: string[][] | undefined): BookLevel[] {
  if (!raw) return [];
  const out: BookLevel[] = [];
  for (const level of raw) {
    const p = Number(level[0]);
    const q = Number(level[1]);
    if (q > 0) out.push([p, q] as BookLevel);
  }
  return out;
}

function mapSymbol(symbol: string): string {
  const { base, quote } = parsePair(symbol);
  return `${base}_${quote}`;
}
