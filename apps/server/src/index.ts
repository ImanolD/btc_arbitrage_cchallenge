import http from "node:http";
import express from "express";
import cors from "cors";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ConnectionStatus,
  ExchangeId,
  FeedStatus,
  ServerToClientEvents,
} from "@arb/shared";
import {
  DEMO_MODE_DEFAULT,
  PORT,
  SYMBOL,
  engineConfig,
  triangularConfig,
} from "./config.js";
import { createConnectors } from "./exchanges/index.js";
import { BinanceConnector } from "./exchanges/binance.js";
import { ArbitrageEngine } from "./engine/arbitrageEngine.js";
import { TriangularEngine } from "./engine/triangularEngine.js";
import { DemoMarketMaker } from "./demo/demoMarketMaker.js";

const app = express();
app.use(cors());

const engine = new ArbitrageEngine(engineConfig);
const feedStatus = new Map<ExchangeId, FeedStatus>();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    symbol: SYMBOL,
    exchanges: engineConfig.exchanges,
    feeds: [...feedStatus.values()],
  });
});

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: "*" },
});

type ArbSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
const clients = new Set<ArbSocket>();

/**
 * Emit to every connected client by iterating sockets directly. We avoid
 * `io.emit` broadcasts because they are unreliable under the Bun runtime; a
 * per-socket emit is well-behaved and equivalent for our single-namespace use.
 */
function broadcast<E extends keyof ServerToClientEvents>(
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  for (const socket of clients) socket.emit(event, ...args);
}

// Engine → clients. Books are emitted directly from connectors below; engine
// emits the derived analytics.
engine.on("opportunity", (opp) => broadcast("opportunity", opp));
engine.on("trade", (trade) => broadcast("trade", trade));
engine.on("portfolio", (stats) => broadcast("portfolio", stats));
engine.on("latency", (stats) => broadcast("latency", stats));

io.on("connection", (socket: ArbSocket) => {
  clients.add(socket);

  // Replay current state so a freshly-connected dashboard isn't blank.
  socket.emit("config", engineConfig);
  socket.emit("feeds", [...feedStatus.values()]);
  socket.emit("portfolio", engine.portfolioStats());
  socket.emit("latency", engine.latencySnapshot());

  socket.on("sync", () => {
    socket.emit("config", engineConfig);
    socket.emit("portfolio", engine.portfolioStats());
  });

  socket.on("setDemo", (enabled: boolean) => setDemoMode(enabled));

  socket.on("disconnect", () => clients.delete(socket));
});

// Synthetic demo/replay venue — feeds the engine like any other connector.
const demo = new DemoMarketMaker(SYMBOL, () => engine.currentReferencePrice());
demo.on("book", (book) => {
  engine.onBook(book);
  broadcast("book", book);
  const fs = feedStatus.get("demo");
  if (fs) fs.lastUpdate = book.receivedAt;
});

function setDemoMode(enabled: boolean): void {
  if (enabled === engineConfig.demoMode) return;
  engineConfig.demoMode = enabled;
  if (enabled) {
    feedStatus.set("demo", {
      exchange: "demo",
      status: "connected",
      lastUpdate: null,
    });
    demo.start();
  } else {
    demo.stop();
    feedStatus.delete("demo");
  }
  broadcast("config", engineConfig);
  broadcast("feeds", [...feedStatus.values()]);
  console.log(`[demo] ${enabled ? "ENABLED" : "disabled"}`);
}

// Wire up exchange connectors.
const connectors = createConnectors(engineConfig.exchanges, SYMBOL);
for (const connector of connectors) {
  feedStatus.set(connector.id, {
    exchange: connector.id,
    status: "connecting",
    lastUpdate: null,
  });

  connector.on("book", (book) => {
    engine.onBook(book);
    broadcast("book", book);
    const fs = feedStatus.get(connector.id);
    if (fs) fs.lastUpdate = book.receivedAt;
  });

  connector.on("status", (status: ConnectionStatus) => {
    const fs = feedStatus.get(connector.id);
    if (fs) fs.status = status;
    broadcast("feeds", [...feedStatus.values()]);
    console.log(`[${connector.id}] ${status}`);
  });

  connector.start();
}

engine.start();

// Triangular arbitrage on a single venue (Binance) across three pairs. These
// connectors feed ONLY the triangular engine — they are different symbols and
// must not enter the cross-exchange book stream.
const triangular = new TriangularEngine(
  triangularConfig.exchange,
  { btcQuote: "BTC/USDT", interBase: "ETH/BTC", interQuote: "ETH/USDT" },
  triangularConfig.pairs,
  triangularConfig.notionalUsd,
  engineConfig.minNetProfitUsd,
);
triangular.on("triangular", (opp) => broadcast("triangular", opp));

const triRoutes: Array<[symbol: string, displayPair: string]> = [
  [triangularConfig.symbols.btcQuote, "BTC/USDT"],
  [triangularConfig.symbols.interBase, "ETH/BTC"],
  [triangularConfig.symbols.interQuote, "ETH/USDT"],
];
const triConnectors = triRoutes.map(([streamSymbol, displayPair]) => {
  const c = new BinanceConnector(streamSymbol);
  c.on("book", (book) => triangular.onBook(displayPair, book));
  c.start();
  return c;
});

// Honour DEMO_MODE at boot (config starts true; flip via setDemoMode to start).
if (DEMO_MODE_DEFAULT) {
  engineConfig.demoMode = false;
  setDemoMode(true);
}

server.listen(PORT, () => {
  console.log(`⚡ arbitrage server listening on :${PORT}`);
  console.log(`   symbol=${SYMBOL} exchanges=${engineConfig.exchanges.join(",")}`);
});

function shutdown() {
  console.log("\nshutting down…");
  for (const c of connectors) c.stop();
  for (const c of triConnectors) c.stop();
  demo.stop();
  engine.stop();
  io.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
