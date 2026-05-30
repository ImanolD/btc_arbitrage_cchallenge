import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { ConnectionStatus, ExchangeId, TopOfBook } from "@arb/shared";

export interface ConnectorEvents {
  book: (book: TopOfBook) => void;
  status: (status: ConnectionStatus) => void;
}

/**
 * Base WebSocket connector with the robustness the latency criterion rewards:
 * persistent connection, heartbeat, and auto-reconnect with capped backoff.
 * Subclasses implement the exchange-specific subscribe + message parsing.
 */
export abstract class BaseConnector extends EventEmitter {
  abstract readonly id: ExchangeId;
  protected abstract readonly url: string;

  protected ws: WebSocket | null = null;
  private shouldRun = false;
  private reconnectAttempts = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(protected readonly symbol: string) {
    super();
  }

  start(): void {
    this.shouldRun = true;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    this.clearHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  /** Subscription message(s) to send once the socket opens. */
  protected abstract onOpen(): void;

  /** Parse a raw message and emit `book` when a fresh top-of-book is ready. */
  protected abstract handleMessage(raw: WebSocket.RawData): void;

  protected emitBook(book: TopOfBook): void {
    this.emit("book", book);
  }

  private connect(): void {
    if (!this.shouldRun) return;
    this.setStatus("connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.startHeartbeat();
      this.onOpen();
    });

    ws.on("message", (data) => {
      try {
        this.handleMessage(data);
      } catch (err) {
        console.error(`[${this.id}] message parse error`, err);
      }
    });

    ws.on("error", (err) => {
      console.error(`[${this.id}] socket error: ${(err as Error).message}`);
    });

    ws.on("close", () => {
      this.clearHeartbeat();
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempts, 6));
    console.warn(`[${this.id}] reconnecting in ${delay}ms`);
    setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, 15_000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private setStatus(status: ConnectionStatus): void {
    this.emit("status", status);
  }

  protected send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

// Strongly-typed event overloads.
export interface BaseConnector {
  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): this;
  emit<E extends keyof ConnectorEvents>(
    event: E,
    ...args: Parameters<ConnectorEvents[E]>
  ): boolean;
}
