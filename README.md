# BTC Arbitrage Terminal

Detección de **arbitraje de Bitcoin entre exchanges** en tiempo real y **ejecución simulada**, construido para el reto de arbitraje de BTC. El sistema transmite order books en vivo de múltiples exchanges vía WebSocket, detecta divergencias de precio en el instante en que ocurren, calcula la rentabilidad **neta de comisiones y slippage por profundidad**, aplica controles de riesgo y simula la ejecución con llenados parciales y seguimiento de balances por wallet — todo visualizado en una terminal de trading en vivo.

> El código y los comentarios están en inglés (estándar de ingeniería); la documentación está en español por tratarse de una competencia en México. Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) para el detalle técnico.

## Por qué este diseño

- **Dirigido por eventos, no por polling.** El motor reevalúa en cada *tick* del order book y solo reverifica los pares de venues afectados por esa actualización — O(N) por actualización, no O(N²).
- **La ganancia neta se calcula recorriendo el book.** Una operación que se ve bien en el *top-of-book* a menudo se vuelve negativa dos niveles más abajo. Nunca asumimos que el mejor precio llena todo el tamaño.
- **Modelo de inventario, no transferencias por operación.** Las mesas de arbitraje reales pre-posicionan capital en ambos venues — la liquidación on-chain de BTC (~10–60 min) mataría toda oportunidad. Los balances se desvían con el tiempo (un venue acumula BTC, el otro USD), y mostramos esa desviación en lugar de esconderla tras transferencias instantáneas ficticias.
- **Costo de retiro amortizado, no por operación.** El *withdrawal fee* es un costo de **rebalanceo**: solo se cobra cuando la desviación de inventario supera un umbral y obliga a una transferencia on-chain. Lo amortizamos entre las operaciones y lo mostramos como "costo de rebalanceo / operación" — restarlo en cada trade descartaría oportunidades reales.
- **Priorización por ganancia neta.** En cada tick se ejecutan las oportunidades accionables de mayor a menor neto (no "la primera que aparece"), asignando el capital a la mejor primero; el dashboard resalta la "mejor ejecutable ahora".
- **Compuerta de riesgo antes de ejecutar.** Guarda de feed obsoleto, guarda de spread inverosímil (*glitch* de datos) y umbral mínimo de ganancia neta median entre "detectado" y "ejecutado".

## Arquitectura

```
Feeds WS (Binance · Kraken · OKX · Bybit · KuCoin · Gate.io · Bitstamp · Bitfinex)
        │  TopOfBook normalizado (escalera bids/asks + quote + timestamps)
        ▼
  OrderBookStore (en memoria, por exchange)
        ▼
  ArbitrageEngine  ── en cada tick ──▶  net-profit (depth walk) ──▶ RiskManager
        │                                                             │
        ├──▶ ExecutionSimulator (llenados parciales, balances)  ◀─────┘
        ├──▶ Portfolio (P&L, curva de equity)
        └──▶ LatencyTracker (procesamiento p50/p95/p99, antigüedad de feeds)
        │  Socket.IO
        ▼
  Dashboard web (Vite + React + shadcn/ui): books en vivo, feed de
  oportunidades (bruto vs neto), blotter de operaciones, curva de equity,
  panel de latencia y arbitraje triangular.
```

### Estructura del monorepo

```
btc_arbitrage_cchallenge/
├── packages/shared/   # Tipos de punta a punta = el contrato de datos de
│                      # Socket.IO, importado por AMBAS apps para no desincronizar.
├── apps/server/       # El bot: connectors, motor, simulador, Socket.IO.
└── apps/web/          # El dashboard: Vite + React + Tailwind + shadcn/ui.
```

## Stack tecnológico

- **Servidor:** Node + TypeScript, `ws` (feeds de exchange), `socket.io` (push al UI), Express (health). Corre con `tsx` en desarrollo y Node puro en producción. (Intencionalmente **no** corremos el servidor en Bun: los broadcasts de `socket.io` son poco confiables bajo el runtime actual de Bun — ver abajo.)
- **Web:** Vite 6, React 18, TypeScript, TailwindCSS, **shadcn/ui** (Radix), Recharts.
- **Tooling:** Bun workspaces (instalación + ejecución de tareas); el proceso del servidor se ejecuta en Node.

### Connectors

| Exchange | Canal | Quote | Notas |
|----------|-------|-------|-------|
| Binance | `@depth20@100ms` | USDT | snapshot parcial del book |
| Kraken | `book` v2 | USDT | snapshot + deltas, book local mantenido |
| OKX | `books5` | USDT | snapshot del top-5 por cambio |
| Bybit | `orderbook.50` | USDT | snapshot + deltas, *ping* JSON de keepalive |
| KuCoin | `level2Depth50` | USDT | bootstrap de token vía REST + *ping* JSON |
| Gate.io | `spot.order_book` | USDT | snapshot limitado cada 100ms |
| Bitstamp | `order_book_{pair}` | USD | snapshot top-100 por cambio |
| Bitfinex | `book` v2 | USD | snapshot + deltas, book local mantenido |

Todos los feeds son **públicos y sin API keys** (clean-room: el repo corre tal cual, sin credenciales). Agregar un venue es un solo archivo nuevo que implementa `BaseConnector` más una entrada en el registro.

**Agrupación por moneda de cotización.** Cada book lleva su `quote` (USDT/USD) y el motor **solo compara venues que cotizan el mismo activo**: cruzar un book BTC/USD con uno BTC/USDT surgiría un "arbitraje" fantasma que en realidad es el riesgo del peg de USDT, no un spread libre. Así, los venues USDT y USD forman dos *pools* independientes.

## Latencia: cómo se mide

Cada detección marca tres instantes:

| Símbolo | Significado |
|---------|-------------|
| `t0` | tiempo del evento del exchange (cuando está disponible) |
| `t1` | tiempo de recepción local del WebSocket |
| `t2` | tiempo de detección de la oportunidad |

- **Latencia de procesamiento** = `t2 − t1` — puramente nuestro código, independiente del desfase de relojes. Es el número que controlamos y optimizamos; se muestra en vivo como p50 / p95 / p99.
- **Latencia de feed** = `t1 − t0` — red + exchange, indicativa.

Optimizaciones en la ruta caliente: estado plano en memoria, nada bloqueante en el handler de mensajes, estadísticas agregadas empujadas en cadencia fija (fuera de la ruta caliente), y el navegador almacena en buffer los books de alta frecuencia y los vuelca en `requestAnimationFrame`.

## Arbitraje triangular

Además del arbitraje cross-exchange, el sistema monitorea **arbitraje triangular** de forma independiente en **cada venue configurado** (por defecto Binance, OKX, Bybit, KuCoin y Gate.io) sobre `BTC/USDT · ETH/BTC · ETH/USDT`, evaluando ambas direcciones del ciclo (`USDT → BTC → ETH → USDT` y su inverso) netas de tres *taker fees*. Cada venue obtiene sus propios tres connectors; el arbitraje triangular es intrínsecamente de **un solo exchange** (los tres pares deben ejecutarse en el mismo libro), por eso se corre por venue en vez de mezclar precios entre exchanges.

## Modo demo / replay

Los arbitrajes netos positivos reales entre venues importantes son prácticamente inexistentes, así que un demo puramente en vivo muestra un blotter (honestamente) vacío. Para demostrar la ruta de ejecución completa — llenados parciales, desviación de balances, P&L realizado, curva de equity — existe un **modo demo claramente etiquetado**:

- Un venue sintético `demo` cotiza alrededor del precio de referencia en vivo e inyecta dislocaciones breves y realistas, suficientes para superar las comisiones de ida y vuelta.
- Todo lo demás es el motor real: detección, net-profit por profundidad, riesgo, simulador, portafolio.
- Es **imposible confundirlo con datos reales** — se muestra un banner permanente y el venue se llama `demo`.

Actívalo en vivo desde el dashboard (botón **Demo**), o arranca con él encendido:

```bash
DEMO_MODE=true bun run dev:server
```

## Ejecución local

Requiere [Bun](https://bun.sh) (o Node ≥ 20).

```bash
bun install
cp .env.example .env   # opcional; trae valores por defecto razonables
bun run dev            # levanta servidor (:4000) y web (:5173) juntos
```

Luego abre http://localhost:5173.

Por separado:

```bash
bun run dev:server
bun run dev:web
```

## Configuración

Todo es opcional — ver `.env.example`. Lo más relevante:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `EXCHANGES` | `binance,kraken,okx,bybit,kucoin,gate,bitstamp,bitfinex` | Connectors de exchange habilitados |
| `TRIANGULAR_EXCHANGES` | `binance,okx,bybit,kucoin,gate` | Venues con arbitraje triangular |
| `SYMBOL` | `BTCUSDT` | Par a monitorear |
| `MAX_NOTIONAL_USD` | `50000` | Tope nominal por pata simulada |
| `MIN_NET_PROFIT_USD` | `1` | Ganancia neta mínima para ejecutar |
| `MAX_SANE_SPREAD_PCT` | `0.05` | Rechaza spreads más anchos como datos erróneos |
| `MAX_QUOTE_AGE_MS` | `2000` | Guarda de feed obsoleto |
| `REBALANCE_THRESHOLD_BTC` | `0.5` | Desviación de inventario que dispara un rebalanceo (cobra withdrawal fee amortizado) |
| `DEMO_MODE` | `false` | Arrancar con el inyector demo/replay encendido |

## Despliegue

- **Web** → Vercel (directorio raíz `apps/web`).
- **Servidor** → Railway / Render (directorio raíz `apps/server`) — requiere un proceso de larga vida para las conexiones WebSocket.

## Nota sobre el realismo

El arbitraje limpio de BTC/USDT entre venues importantes es **raro y de poca profundidad** — los mercados eficientes cierran estas brechas rápido. Un sistema que muestra *pocas pero genuinamente positivas* oportunidades (y rechaza las falsas) es más honesto que uno que aparenta "imprimir dinero", lo cual suele indicar un error de modelado.
