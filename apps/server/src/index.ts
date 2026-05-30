import http from "node:http";
import express from "express";
import cors from "cors";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ConnectionStatus,
  EngineConfigPatch,
  ExchangeId,
  FeedStatus,
  ServerToClientEvents,
} from "@arb/shared";
import {
  DEMO_MODE_DEFAULT,
  PORT,
  SYMBOL,
  TRIANGULAR_EXCHANGES,
  TRIANGULAR_NOTIONAL_USD,
  TRIANGULAR_PAIRS,
  TRIANGULAR_SYMBOLS,
  engineConfig,
} from "./config.js";
import { BaseConnector, createConnector, createConnectors } from "./exchanges/index.js";
import { ArbitrageEngine } from "./engine/arbitrageEngine.js";
import { TriangularEngine } from "./engine/triangularEngine.js";
import { DemoMarketMaker } from "./demo/demoMarketMaker.js";
import { FiloAgent } from "./filo/filoAgent.js";
import { WhatsAppBridge } from "./filo/whatsappBridge.js";
import {
  verifyWebhook,
  whatsappKeyword,
  whatsappLink,
  whatsappReady,
} from "./filo/whatsapp.js";

const app = express();
app.use(cors());
// Capture the raw body so we can verify webhook HMAC signatures byte-for-byte.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);

const engine = new ArbitrageEngine(engineConfig);
const filo = new FiloAgent(engineConfig);
filo.attach(engine);
const whatsapp = new WhatsAppBridge(filo);
const feedStatus = new Map<ExchangeId, FeedStatus>();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    symbol: SYMBOL,
    exchanges: engineConfig.exchanges,
    feeds: [...feedStatus.values()],
  });
});

// Whether the dashboard should show the "chat with Filo on WhatsApp" affordance,
// plus the click-to-chat link (which is what opens WhatsApp's 24h window).
app.get("/api/whatsapp/info", (_req, res) => {
  res.json({
    enabled: whatsappReady(),
    link: whatsappLink(),
    keyword: whatsappKeyword(),
    subscribers: whatsapp.activeCount(),
  });
});

// Inbound messages from Kapso. We verify the signature, ack fast, process async.
app.post("/api/whatsapp/webhook", (req, res) => {
  const raw = (req as express.Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  const signature = req.header("X-Webhook-Signature");
  if (!verifyWebhook(raw, signature)) {
    res.status(401).send("invalid signature");
    return;
  }
  res.status(200).send("ok");
  whatsapp.handleWebhook(req.body).catch((err) => console.warn("[whatsapp] webhook", err));
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
engine.on("stats", (stats) => broadcast("stats", stats));

// Filo's unprompted narrations go to everyone watching.
filo.on("message", (msg) => broadcast("filo", msg));

io.on("connection", (socket: ArbSocket) => {
  clients.add(socket);

  // Replay current state so a freshly-connected dashboard isn't blank.
  socket.emit("config", engineConfig);
  socket.emit("feeds", [...feedStatus.values()]);
  socket.emit("portfolio", engine.portfolioStats());
  socket.emit("latency", engine.latencySnapshot());
  // Replay Filo's recent chatter so the chat panel has context on open.
  for (const msg of filo.backlog()) socket.emit("filo", msg);

  socket.on("sync", () => {
    socket.emit("config", engineConfig);
    socket.emit("portfolio", engine.portfolioStats());
  });

  socket.on("setDemo", (enabled: boolean) => setDemoMode(enabled));

  socket.on("updateConfig", (patch) => applyConfigPatch(patch));

  // A question only concerns the asker; the reply goes back to that socket.
  socket.on("filoAsk", (payload) => {
    if (!payload || typeof payload.text !== "string") return;
    const lang = payload.lang === "en" ? "en" : "es";
    filo
      .ask(payload.text.slice(0, 500), lang)
      .then((answer) => socket.emit("filo", answer))
      .catch((err) => console.warn("[filo] ask failed", err));
  });

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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Apply a live config patch from the dashboard. Every field is validated and
 * clamped to a safe range before mutating the shared `engineConfig` (which the
 * engine, risk manager and Filo all read by reference), then re-broadcast.
 */
function applyConfigPatch(patch: EngineConfigPatch): void {
  if (!patch || typeof patch !== "object") return;

  if (patch.decisionMode === "ev" || patch.decisionMode === "spread") {
    engineConfig.decisionMode = patch.decisionMode;
  }
  if (typeof patch.minNetProfitUsd === "number" && Number.isFinite(patch.minNetProfitUsd)) {
    engineConfig.minNetProfitUsd = clamp(patch.minNetProfitUsd, 0, 1_000_000);
  }
  if (patch.ev) {
    const { tauMs, adverseBps, minEvUsd } = patch.ev;
    if (typeof tauMs === "number" && Number.isFinite(tauMs)) {
      engineConfig.ev.tauMs = clamp(tauMs, 10, 60_000);
    }
    if (typeof adverseBps === "number" && Number.isFinite(adverseBps)) {
      engineConfig.ev.adverseBps = clamp(adverseBps, 0, 1_000);
    }
    if (typeof minEvUsd === "number" && Number.isFinite(minEvUsd)) {
      engineConfig.ev.minEvUsd = clamp(minEvUsd, -1_000_000, 1_000_000);
    }
  }
  if (patch.filo) {
    if (typeof patch.filo.narrate === "boolean") {
      engineConfig.filo.narrate = patch.filo.narrate;
    }
    if (typeof patch.filo.digestMs === "number" && Number.isFinite(patch.filo.digestMs)) {
      engineConfig.filo.digestMs =
        patch.filo.digestMs <= 0 ? 0 : clamp(patch.filo.digestMs, 5_000, 600_000);
    }
    filo.applyConfig();
  }

  broadcast("config", engineConfig);
  console.log(
    `[config] mode=${engineConfig.decisionMode} minNet=${engineConfig.minNetProfitUsd} ` +
      `ev(tau=${engineConfig.ev.tauMs},adv=${engineConfig.ev.adverseBps},min=${engineConfig.ev.minEvUsd}) ` +
      `filo(digest=${engineConfig.filo.digestMs},narrate=${engineConfig.filo.narrate})`,
  );
}

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
  filo.noteDemo(enabled);
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
    // Defensive: never process or display a crossed book (bid >= ask). Local
    // order-book connectors can momentarily desync; drop the tick and wait for
    // the next clean one rather than surfacing an impossible quote.
    if (book.bestBid >= book.bestAsk) return;
    engine.onBook(book);
    broadcast("book", book);
    const fs = feedStatus.get(connector.id);
    if (fs) fs.lastUpdate = book.receivedAt;
  });

  connector.on("status", (status: ConnectionStatus) => {
    const fs = feedStatus.get(connector.id);
    const wasConnected = fs?.status === "connected";
    if (fs) fs.status = status;
    broadcast("feeds", [...feedStatus.values()]);
    // Let Filo flag a venue that drops after having been live.
    if (wasConnected && status === "disconnected") filo.noteFeedDown(connector.id);
    console.log(`[${connector.id}] ${status}`);
  });

  connector.start();
}

engine.start();
filo.start();
// Optional WhatsApp transport for Filo (no-ops cleanly when unconfigured).
whatsapp.start().catch((err) => console.warn("[whatsapp] start failed", err));

// Triangular arbitrage: one independent engine per venue across the cycle
// BTC/USDT · ETH/BTC · ETH/USDT. Each venue gets its own three connectors,
// which feed ONLY the triangular engine and never enter the cross-exchange
// book stream (they are different symbols).
const triRoutes: Array<[symbol: string, displayPair: string]> = [
  [TRIANGULAR_SYMBOLS.btcQuote, TRIANGULAR_PAIRS[0]],
  [TRIANGULAR_SYMBOLS.interBase, TRIANGULAR_PAIRS[1]],
  [TRIANGULAR_SYMBOLS.interQuote, TRIANGULAR_PAIRS[2]],
];

const triConnectors: BaseConnector[] = [];
for (const exchange of TRIANGULAR_EXCHANGES) {
  const triangular = new TriangularEngine(
    exchange,
    { btcQuote: TRIANGULAR_PAIRS[0], interBase: TRIANGULAR_PAIRS[1], interQuote: TRIANGULAR_PAIRS[2] },
    TRIANGULAR_PAIRS,
    TRIANGULAR_NOTIONAL_USD,
    engineConfig.minNetProfitUsd,
  );
  triangular.on("triangular", (opp) => broadcast("triangular", opp));

  for (const [streamSymbol, displayPair] of triRoutes) {
    const c = createConnector(exchange, streamSymbol);
    if (!c) continue;
    c.on("book", (book) => triangular.onBook(displayPair, book));
    c.start();
    triConnectors.push(c);
  }
}

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
  filo.stop();
  void whatsapp.stop();
  io.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
