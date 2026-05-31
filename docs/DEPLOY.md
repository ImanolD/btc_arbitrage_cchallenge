# Deployment guide

This repo ships **two deployables** from one monorepo:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| **Server** (`apps/server`) | Long-lived Node process: Express + Socket.IO + 8 live exchange WebSocket feeds + Filo + WhatsApp bridge | A host that keeps a process alive and supports WebSockets (Railway / Render / Fly.io) |
| **Web** (`apps/web`) | Static Vite + React SPA | Any static/CDN host (Vercel / Netlify / Cloudflare Pages) |

The web app talks to the server over Socket.IO (WebSocket, with polling fallback) and a couple of REST endpoints, so you deploy the **server first**, grab its public URL, then build the web app pointing at it.

> [!IMPORTANT]
> **Run the server on Node, not Bun.** Socket.IO broadcasts are unreliable under the Bun runtime, so the dev server already uses `tsx` (Node) and so must production. We start it with `tsx` directly — no compile step — because `@arb/shared` is consumed as TypeScript source (`"main": "./src/index.ts"`), so there is no separate compiled entrypoint for it to resolve at runtime. `tsx` handles the TS + workspace resolution exactly like dev. The root script is already set up:
> ```jsonc
> // package.json
> "start": "tsx apps/server/src/index.ts"
> ```

---

## 0. Prerequisites

- Node **20+** (the live test ran on Node 24; anything ≥20 is fine).
- The repo installs with `bun install` (there's a Bun lockfile) — `npm install` also works. Either way you only use the package manager to **install**; the server itself runs on Node via `tsx`.
- Accounts on your chosen hosts (Railway + Vercel below).

---

> [!TIP]
> **Infra is committed.** [`railway.json`](../railway.json) + [`nixpacks.toml`](../nixpacks.toml), [`render.yaml`](../render.yaml), and [`vercel.json`](../vercel.json) live at the repo root, so the build/start/health-check settings below are applied automatically — on most hosts you just connect the repo and set env vars.

## 1. Deploy the server (Railway — recommended)

Railway keeps the process warm (important: the server must stay up to keep WebSocket feeds live, push WhatsApp updates within the 24h window, and receive webhooks). Render's free tier sleeps on idle, which breaks all three — only use Render on a paid/always-on plan.

1. **New Project → Deploy from GitHub repo** → pick `btc_arbitrage_cchallenge`.
2. Keep the **root directory = repo root** (`/`). This is a monorepo; the workspace install must run from the root so `@arb/shared` symlinks correctly.
3. **Build & start are pre-configured** by `railway.json` + `nixpacks.toml`:
   - `nixpacks.toml` forces a **Node** runtime (not Bun) and installs with `npm install` (no app build step — the server runs from TS source via `tsx`).
   - `railway.json` sets the start command (`npm start` → `tsx apps/server/src/index.ts`), the `/health` health check, and an on-failure restart policy.
   - You normally don't need to touch the build/start fields in the UI.
4. **Pick a non-US region** (Settings → Region) — e.g. **EU West (Amsterdam)** or **Southeast Asia (Singapore)**. This matters: **Binance.com geo-blocks US IPs (HTTP 451)**, so deploying in a US region (like `iad1`) leaves the Binance feed permanently `disconnected`. A region change only takes effect on a **new deployment**, so redeploy after changing it. (Alternatively, drop Binance via the `EXCHANGES`/`TRIANGULAR_EXCHANGES` vars — see [section 3](#3-server-environment-variables).)
5. **Networking → Generate Domain.** You get something like `https://btc-arb-server.up.railway.app`. Save it — the web app needs it.
6. **Variables:** see [section 3](#3-server-environment-variables). At minimum the server runs with **zero** config (sensible defaults, in-memory storage, WhatsApp disabled). `PORT` is injected by Railway automatically — the server reads `process.env.PORT`.

**Verify:** open `https://<your-server>/health` — you should get JSON with `"ok": true` and a `feeds` array showing each exchange `"connected"`.

<details>
<summary>Render alternative (Blueprint)</summary>

The repo ships [`render.yaml`](../render.yaml), which provisions **both** the server and the static web app in one go:

- **New → Blueprint**, point it at the repo, and Render reads `render.yaml`.
- It creates `filobot-server` (Node web service, `npm start`, health check `/health`) and `filobot-web` (static site).
- Bump `filobot-server` to an **always-on** plan (the free tier sleeps and will drop feeds + WhatsApp), and set `VITE_SERVER_URL` on `filobot-web` to the server's URL.
</details>

<details>
<summary>Fly.io alternative</summary>

`fly launch` from the repo root, choose a Node builder, set the internal port to whatever you put in `PORT` (default 4000), and use `npm start` as the process command. Make sure the service exposes HTTP/WS on 443. Pick a **non-US region** so Binance connects (e.g. `fly regions set ams`).
</details>

---

## 2. Deploy the web app (Vercel — recommended)

The web app is a static bundle; it just needs to be built with `VITE_SERVER_URL` pointing at the server from step 1.

1. **New Project → import the same repo.**
2. **Leave the Root Directory at the repo root** (don't set it to `apps/web`). [`vercel.json`](../vercel.json) drives everything: it installs from the root so the `@arb/shared` workspace resolves, builds only the web app (`npm run build -w @arb/web`), and serves `apps/web/dist`. Vercel auto-detects this file, so the install/build/output fields are pre-filled.
3. **Environment variable:**
   | Key | Value |
   | --- | --- |
   | `VITE_SERVER_URL` | `https://<your-server>` (the Railway domain from step 1, **https**, no trailing slash) |
4. Deploy. Visit the Vercel URL — the dashboard should connect (top-left status goes green) and the opportunity feed starts streaming.

> `VITE_*` vars are baked in **at build time**. If you change `VITE_SERVER_URL` later, you must **redeploy** the web app.
>
> ⚠️ Don't set the Vercel Root Directory to `apps/web` — installing inside that subfolder can't resolve the `workspace:*` dependency on `@arb/shared`. The install must happen at the repo root, which is exactly what `vercel.json` does.

<details>
<summary>Netlify / Cloudflare Pages</summary>

Same idea — install at the repo root, build only the web workspace:
- Build command: `npm install && npm run build -w @arb/web`
- Publish directory: `apps/web/dist`
- Set `VITE_SERVER_URL`.

Both serve the SPA fine; the SPA rewrite is optional (the app is a single page), but a `/* → /index.html` rewrite is harmless and already declared in `vercel.json`/`render.yaml`.
</details>

---

## 3. Server environment variables

Everything has a default — the server boots with none of these set. Full reference and comments live in [`.env.example`](../.env.example). The ones that matter for a live deploy:

**Core (optional — defaults are good):**
- `PORT` — injected by the host; don't hardcode.
- `EXCHANGES`, `SYMBOL`, `TRIANGULAR_EXCHANGES`, `DEMO_MODE`, the engine/EV knobs — tune only if you want to.

**Persistence (optional):**
- `MONGODB_URI` — a MongoDB Atlas connection string. When set, WhatsApp opt-ins survive restarts; when unset, the server uses in-memory storage (clean-room). `MONGODB_DB` defaults to `filobot`.

**Filo by WhatsApp (optional — only if you want the WhatsApp button to appear):**
- `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET`
- `WHATSAPP_NUMBER` (E.164, digits only — used for the `wa.me`/QR link)
- `WHATSAPP_KEYWORD` (default `Filo`), `WHATSAPP_MIN_PUSH_SEC` (default `45`)

**Filo LLM layer (optional):**
- `ANTHROPIC_API_KEY` — enables free-form Claude answers; without it Filo still answers deterministically.

> The web app needs exactly one var: `VITE_SERVER_URL` (set on the **web** host, not the server).

---

## 4. CORS

No action needed. The server sets `cors()` and Socket.IO `origin: "*"`, so the web app can connect from any domain. If you ever want to lock it down to your Vercel domain, that's the one place to change.

---

## 5. Wire up WhatsApp (only if using it)

1. Set the WhatsApp vars from section 3 on the server and redeploy.
2. In the **Kapso** dashboard, point the inbound **webhook** at:
   ```
   https://<your-server>/api/whatsapp/webhook
   ```
   and use the same secret you put in `KAPSO_WEBHOOK_SECRET` (inbound requests are rejected unless the `X-Webhook-Signature` HMAC matches).
3. Confirm the affordance is live: `https://<your-server>/api/whatsapp/info` should return `{"enabled": true, "link": "...", ...}`. When enabled, the Filo chat shows the "Get alerts on WhatsApp" button, which opens a QR (scan from a phone) plus a direct open link.

---

## 6. Post-deploy smoke test

- [ ] `GET https://<server>/health` → `ok: true`, all feeds `connected`.
- [ ] Web app loads, status indicator goes green, opportunity feed streams.
- [ ] Open Filo chat → ask "¿Qué latencia tienes?" → get a grounded answer.
- [ ] Settings panel → toggle EV ↔ spread → feed reacts live.
- [ ] (If WhatsApp on) `GET https://<server>/api/whatsapp/info` → `enabled: true`; the WhatsApp button + QR appear in the chat.
- [ ] Open the site on a phone — header collapses to the menu, modals become bottom sheets, Filo is a full-height sheet.

---

## 7. Local production check (optional)

Reproduce the exact prod start locally before pushing:

```bash
bun install            # or npm install
npm start              # tsx apps/server/src/index.ts  → http://localhost:4000
# in another terminal:
VITE_SERVER_URL=http://localhost:4000 npm --prefix apps/web run build
npm --prefix apps/web run preview   # serves the built SPA
```
