import type WebSocket from "ws";
import type { BookLevel, ExchangeId, QuoteAsset } from "@arb/shared";
import { BaseConnector } from "./base.js";
import { parsePair, quoteAssetOf } from "./symbols.js";

const DEPTH = 25;

/**
 * Bitfinex v2 public `book` channel. Bitfinex sends a snapshot followed by
 * per-level deltas of the form `[price, count, amount]`: `amount > 0` is a bid
 * and `amount < 0` is an ask, and `count === 0` removes the level. We maintain
 * a local book like Kraken. Bitfinex is quoted in USD here, so the engine
 * groups it apart from the USDT venues.
 * Docs: https://docs.bitfinex.com/reference/ws-public-books
 */
export class BitfinexConnector extends BaseConnector {
  readonly id: ExchangeId = "bitfinex";
  protected readonly url = "wss://api-pub.bitfinex.com/ws/2";

  private readonly bfxSymbol: string;
  private readonly quote: QuoteAsset;
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();

  constructor(symbol: string) {
    super(symbol);
    this.bfxSymbol = mapSymbol(symbol);
    this.quote = quoteAssetOf(symbol);
  }

  protected onOpen(): void {
    this.bids.clear();
    this.asks.clear();
    this.send({
      event: "subscribe",
      channel: "book",
      symbol: this.bfxSymbol,
      prec: "P0",
      freq: "F0",
      len: String(DEPTH),
    });
  }

  protected handleMessage(raw: WebSocket.RawData): void {
    const receivedAt = Date.now();
    const parsed = JSON.parse(raw.toString());

    // Event objects (info / subscribed / error) arrive as plain objects; we
    // only subscribe to one channel, so the channel id needs no tracking.
    if (!Array.isArray(parsed)) return;

    const payload = parsed[1];
    if (payload === "hb" || !Array.isArray(payload)) return;

    if (Array.isArray(payload[0])) {
      // Snapshot: array of [price, count, amount].
      this.bids.clear();
      this.asks.clear();
      for (const level of payload as number[][]) this.applyLevel(level);
    } else {
      // Single update.
      this.applyLevel(payload as number[]);
    }

    const bids = topLevels(this.bids, "desc");
    const asks = topLevels(this.asks, "asc");
    if (bids.length === 0 || asks.length === 0) return;

    this.emitBook({
      exchange: this.id,
      symbol: this.symbol,
      quote: this.quote,
      bids,
      asks,
      bestBid: bids[0][0],
      bestAsk: asks[0][0],
      // Bitfinex book deltas carry no per-message timestamp.
      exchangeTime: null,
      receivedAt,
    });
  }

  private applyLevel([price, count, amount]: number[]): void {
    if (count > 0) {
      if (amount > 0) this.bids.set(price, amount);
      else if (amount < 0) this.asks.set(price, -amount);
    } else if (count === 0) {
      // amount === 1 removes a bid, amount === -1 removes an ask.
      if (amount === 1) this.bids.delete(price);
      else if (amount === -1) this.asks.delete(price);
    }
  }
}

function topLevels(side: Map<number, number>, dir: "asc" | "desc"): BookLevel[] {
  const entries = [...side.entries()].sort((a, b) =>
    dir === "asc" ? a[0] - b[0] : b[0] - a[0],
  );
  return entries.slice(0, DEPTH).map(([p, q]) => [p, q] as BookLevel);
}

/** Map the generic engine symbol to Bitfinex's `tBASEQUOTE` (USDT → UST). */
function mapSymbol(symbol: string): string {
  const { base, quote } = parsePair(symbol);
  const bfxQuote = quote === "USDT" ? "UST" : quote;
  return `t${base}${bfxQuote}`;
}
