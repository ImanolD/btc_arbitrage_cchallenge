# BTC Arbitrage Terminal

Real-time Bitcoin **cross-exchange arbitrage** detection and **simulated execution**, built for the BTC arbitrage challenge. The system streams live order books from multiple exchanges over WebSockets, detects price divergences the instant they occur, computes profitability **net of fees and depth-walked slippage**, applies risk controls, and simulates execution with partial fills and per-wallet balance tracking — all visualised in a live trading terminal.

## Why this design

- **Event-driven, not polling.** The engine re-evaluates on every order-book tick and only re-checks the venue pairs touched by that update — O(N) per update, not O(N²).
- **Net profit is computed by walking the book.** A trade that looks good at top-of-book often turns negative two levels deep. We never assume the best price fills the whole size.
- **Inventory model, not per-trade transfers.** Real arbitrage desks pre-position capital on both venues — on-chain BTC settlement (~10–60 min) would kill every opportunity. Balances drift over time (one venue accumulates BTC, the other USD), and we surface that drift rather than hiding it behind a fiction of instant transfers.
- **Risk gate before execution.** Stale-feed guard, implausible-spread (data-glitch) guard, and a minimum-net-profit threshold sit between "detected" and "executed".

## Architecture

```
Exchange WS feeds (Binance, Kraken)
        │  normalized TopOfBook (bids/asks ladder + timestamps)
        ▼
  OrderBookStore (in-memory, per exchange)
        ▼
  ArbitrageEngine  ── on every tick ──▶  net-profit (depth walk) ──▶ RiskManager
        │                                                              │
        ├──▶ ExecutionSimulator (partial fills, wallet balances)  ◀────┘
        ├──▶ Portfolio (P&L, equity curve)
        └──▶ LatencyTracker (processing p50/p95/p99, feed age)
        │  Socket.IO
        ▼
  Web dashboard (Vite + React + shadcn/ui): live books, opportunity
  feed (gross vs net), trade blotter, equity curve, latency panel
```

### Monorepo layout

```
btc_arbitrage_cchallenge/
├── packages/shared/   # End-to-end types — the Socket.IO data contract,
│                      # imported by BOTH server and web so they can't drift.
├── apps/server/       # The bot: connectors, engine, simulator, Socket.IO.
└── apps/web/          # The dashboard: Vite + React + Tailwind + shadcn/ui.
```

## Tech stack

- **Server:** Node/Bun + TypeScript, `ws` (exchange feeds), `socket.io` (push to UI), Express (health).
- **Web:** Vite 6, React 18, TypeScript, TailwindCSS, **shadcn/ui** (Radix), Recharts.
- **Tooling:** Bun workspaces.

## Latency: how it's measured

Every detection timestamps three points:

| Symbol | Meaning |
|--------|---------|
| `t0` | exchange event time (when available in the payload) |
| `t1` | local WebSocket receive time |
| `t2` | opportunity-detected time |

- **Processing latency** = `t2 − t1` — purely our code, clock-skew-independent. This is the number we own and optimise; shown live as p50 / p95 / p99.
- **Feed latency** = `t1 − t0` — network + exchange, indicative.

Optimisations on the hot path: flat in-memory state, no blocking work in the message handler, aggregate stats pushed on a fixed cadence (off the hot path), and the browser buffers high-frequency book updates and flushes on `requestAnimationFrame`.

## Running locally

Requires [Bun](https://bun.sh) (or Node ≥ 20).

```bash
bun install
cp .env.example .env   # optional; sensible defaults are built in
bun run dev            # starts server (:4000) and web (:5173) together
```

Then open http://localhost:5173.

Run individually:

```bash
bun run dev:server
bun run dev:web
```

## Configuration

All optional — see `.env.example`. Highlights:

| Var | Default | Description |
|-----|---------|-------------|
| `EXCHANGES` | `binance,kraken` | Enabled exchange connectors |
| `SYMBOL` | `BTCUSDT` | Trading pair to monitor |
| `MAX_NOTIONAL_USD` | `50000` | Notional cap per simulated leg |
| `MIN_NET_PROFIT_USD` | `1` | Minimum net profit to execute |
| `MAX_SANE_SPREAD_PCT` | `0.05` | Reject wider spreads as bad data |
| `MAX_QUOTE_AGE_MS` | `2000` | Stale-feed guard |

## Deployment

- **Web** → Vercel (root directory `apps/web`).
- **Server** → Railway / Render (root directory `apps/server`) — needs a long-lived process for the WebSocket connections.

## Notes on realism

Clean cross-exchange BTC/USDT arbitrage between major venues is **rare and thin** — efficient markets close these gaps fast. A system that surfaces *few but genuinely net-positive* opportunities (and rejects the fake ones) is more honest than one that appears to "print money", which usually signals a modeling bug.
