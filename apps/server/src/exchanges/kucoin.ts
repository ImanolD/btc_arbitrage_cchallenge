import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { BookLevel, ExchangeId, QuoteAsset } from "@arb/shared";
import { BaseConnector } from "./base.js";
import { parsePair, quoteAssetOf } from "./symbols.js";

interface KucoinData {
  asks?: string[][];
  bids?: string[][];
  timestamp?: number;
}

interface KucoinMessage {
  type?: string;
  topic?: string;
  data?: KucoinData;
}

const BULLET_URL = "https://api.kucoin.com/api/v1/bullet-public";

/**
 * KuCoin spot `/spotMarket/level2Depth50` channel — pushes a full top-50
 * snapshot (asks ascending, bids descending) several times per second, so no
 * local book maintenance is needed. KuCoin requires a one-shot REST call to
 * obtain a public WS token + endpoint before connecting, and a JSON `ping`
 * keepalive (sent via the base heartbeat hook).
 * Docs: https://www.kucoin.com/docs/websocket/spot-trading/public-channels/level2-50-best-ask-bid-orders
 */
export class KucoinConnector extends BaseConnector {
  readonly id: ExchangeId = "kucoin";
  protected url = "";

  private readonly kucoinSymbol: string;
  private readonly quote: QuoteAsset;
  private readonly topic: string;
  private readonly connectId = randomUUID();

  constructor(symbol: string) {
    super(symbol);
    this.kucoinSymbol = mapSymbol(symbol);
    this.quote = quoteAssetOf(symbol);
    this.topic = `/spotMarket/level2Depth50:${this.kucoinSymbol}`;
  }

  override start(): void {
    void this.bootstrap();
  }

  /** Fetch a public WS token + endpoint, then hand off to the base connect. */
  private async bootstrap(): Promise<void> {
    try {
      const res = await fetch(BULLET_URL, { method: "POST" });
      const json = (await res.json()) as {
        data?: { token?: string; instanceServers?: { endpoint: string }[] };
      };
      const server = json.data?.instanceServers?.[0];
      const token = json.data?.token;
      if (!server || !token) throw new Error("missing token/endpoint");
      this.url = `${server.endpoint}?token=${encodeURIComponent(token)}&connectId=${this.connectId}`;
      super.start();
    } catch (err) {
      console.error(`[kucoin] bootstrap failed: ${(err as Error).message}; retrying in 5s`);
      setTimeout(() => this.bootstrap(), 5_000);
    }
  }

  protected onOpen(): void {
    this.send({
      id: this.connectId,
      type: "subscribe",
      topic: this.topic,
      response: true,
    });
  }

  protected override heartbeatPayload(): unknown {
    return { id: randomUUID(), type: "ping" };
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const msg = JSON.parse(raw.toString()) as KucoinMessage;
    if (msg.type !== "message" || msg.topic !== this.topic || !msg.data) return;

    const bids = toLevels(msg.data.bids);
    const asks = toLevels(msg.data.asks);
    if (bids.length === 0 || asks.length === 0) return;

    this.emitBook({
      exchange: this.id,
      symbol: this.symbol,
      quote: this.quote,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      exchangeTime: typeof msg.data.timestamp === "number" ? msg.data.timestamp : null,
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
  return `${base}-${quote}`;
}
