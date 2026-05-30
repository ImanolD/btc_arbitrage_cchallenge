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
import { PORT, SYMBOL, engineConfig } from "./config.js";
import { createConnectors } from "./exchanges/index.js";
import { ArbitrageEngine } from "./engine/arbitrageEngine.js";

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

  socket.on("disconnect", () => clients.delete(socket));
});

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

server.listen(PORT, () => {
  console.log(`⚡ arbitrage server listening on :${PORT}`);
  console.log(`   symbol=${SYMBOL} exchanges=${engineConfig.exchanges.join(",")}`);
});

function shutdown() {
  console.log("\nshutting down…");
  for (const c of connectors) c.stop();
  engine.stop();
  io.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
