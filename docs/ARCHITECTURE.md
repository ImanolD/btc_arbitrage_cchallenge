# Arquitectura — BTC Arbitrage Terminal

Este documento describe el diseño técnico del sistema: cómo fluyen los datos desde los exchanges hasta el dashboard, las decisiones de ingeniería relevantes y los porqués detrás de ellas.

> El código, los identificadores y los comentarios están en inglés (estándar de la industria); la documentación está en español por tratarse de una competencia en México.

---

## 1. Panorama general

El sistema detecta oportunidades de **arbitraje de Bitcoin en tiempo real** entre múltiples exchanges y **simula su ejecución** considerando todos los costos. Tiene tres responsabilidades:

1. **Ingerir** order books en vivo de varios exchanges vía WebSocket.
2. **Detectar y evaluar** divergencias de precio, calculando la rentabilidad **neta** (comisiones + slippage por profundidad) y aplicando controles de riesgo.
3. **Simular** la ejecución (con llenados parciales y balances de wallet) y **visualizar** todo en una terminal de trading en vivo.

Se monitorean dos tipos de arbitraje:

- **Cross-exchange:** comprar en el exchange con `ask` más bajo y vender en el de `bid` más alto.
- **Triangular:** dentro de un solo exchange, recorrer un ciclo `USDT → BTC → ETH → USDT` (y su inverso) buscando una ganancia neta.

---

## 2. Estructura del monorepo

```
btc_arbitrage_cchallenge/
├── packages/shared/   # Tipos compartidos = el contrato de datos de Socket.IO.
│                      # Lo importan AMBAS apps, así no se desincronizan.
├── apps/server/       # El bot: connectors, motor, simulador, Socket.IO.
└── apps/web/          # El dashboard: Vite + React + Tailwind + shadcn/ui.
```

`packages/shared` es la **única fuente de verdad** del contrato entre servidor y cliente: los payloads de cada evento de Socket.IO están tipados de punta a punta, por lo que un cambio incompatible se detecta en tiempo de compilación.

---

## 3. Flujo de datos

```
Feeds WS (Binance · Kraken · OKX · Bybit · KuCoin · Gate.io · Bitstamp · Bitfinex)
        │  TopOfBook normalizado (escalera bids/asks + timestamps)
        ▼
  OrderBookStore (en memoria, por exchange)
        ▼
  ArbitrageEngine  ── en cada tick ──▶  net-profit (depth walk) ──▶ RiskManager
        │                                                             │
        ├──▶ ExecutionSimulator (llenados parciales, balances)  ◀─────┘
        ├──▶ Portfolio (P&L, curva de equity)
        └──▶ LatencyTracker (procesamiento p50/p95/p99, antigüedad de feeds)
        │  Socket.IO (emisión por socket)
        ▼
  Dashboard web: books en vivo, feed de oportunidades (bruto vs neto),
  blotter de operaciones, curva de equity, panel de latencia, triangular.
```

El procesamiento es **dirigido por eventos**: el motor reevalúa en **cada actualización de book**, no en un temporizador. Cuando llega un book del exchange X, solo se reverifican los pares que **involucran a X** contra los demás — costo O(N) por actualización, no O(N²) sobre todo el producto cruzado.

**Priorización.** En cada tick el motor no ejecuta "la primera oportunidad que ve": recolecta todas las rutas candidatas que toca la actualización, las emite (incluidas las rechazadas), y luego **ejecuta las accionables en orden de mayor a menor ganancia neta**, de modo que el capital escaso se asigna primero a la mejor oportunidad. El dashboard resalta la "mejor ejecutable ahora".

---

## 4. Connectors de exchange

Cada exchange implementa `BaseConnector`, que aporta la robustez que premia el criterio de latencia: conexión persistente, *heartbeat* y reconexión automática con *backoff* acotado. Las subclases solo implementan la suscripción y el parseo específico.

| Exchange | Canal | Quote | Notas |
|----------|-------|-------|-------|
| Binance | `@depth20@100ms` | USDT | snapshot parcial del book cada 100 ms |
| Kraken | `book` v2 | USDT | snapshot + deltas; se mantiene el book local |
| OKX | `books5` | USDT | snapshot del top-5 en cada cambio |
| Bybit | `orderbook.50` | USDT | snapshot + deltas; *ping* JSON de keepalive |
| KuCoin | `level2Depth50` | USDT | token público vía REST antes de conectar; *ping* JSON |
| Gate.io | `spot.order_book` | USDT | snapshot limitado cada 100 ms |
| Bitstamp | `order_book_{pair}` | USD | snapshot top-100 en cada cambio |
| Bitfinex | `book` v2 | USD | snapshot + deltas; se mantiene el book local |

Todos los feeds son **públicos y sin API keys** (clean-room: el repo corre sin credenciales). Todos normalizan su payload a un `TopOfBook` común (escalera de `bids`/`asks`, mejores bid/ask, `quote` y timestamps). Un helper de parseo (`parsePair`) traduce un símbolo genérico (`BTCUSDT`, `ETHBTC`) al formato propio de cada venue, de modo que el resto del sistema habla un único lenguaje de símbolos. **Agregar un exchange es un solo archivo nuevo** que extiende `BaseConnector`, más una línea en el registro.

### Agrupación por moneda de cotización

Cada `TopOfBook` lleva su `quote` (`USDT` o `USD`). El motor **solo evalúa pares de venues que cotizan el mismo activo**: cruzar un book BTC/USD con uno BTC/USDT produciría un "arbitraje" fantasma que en realidad es exposición al *peg* de USDT (riesgo FX), no un spread libre. Así, los venues USDT y USD forman *pools* de comparación independientes — una salvaguarda de corrección, no solo de presentación.

---

## 5. Cálculo de rentabilidad neta (el corazón del sistema)

La precisión "neta de todo" es lo que distingue a un bot serio de uno ingenuo. Una oportunidad que se ve rentable en el *top-of-book* a menudo se vuelve negativa dos niveles más abajo.

### 5.1 Depth walking

`computeArbitrage` **recorre ambos order books nivel por nivel**, acumulando tamaño mientras el llenado marginal siga siendo rentable **después de comisiones**, y respetando el presupuesto nominal (`maxNotionalUsd`). En cuanto el precio efectivo de compra (`ask × (1 + fee)`) deja de ser menor al efectivo de venta (`bid × (1 − fee)`), se detiene. Nunca se asume que el mejor precio llena todo el tamaño.

### 5.2 Comisiones

Cada exchange tiene su *taker fee* publicada (`feeModels`). Las comisiones se aplican sobre el costo de compra y el ingreso de venta.

### 5.3 Modelo de inventario vs. transferencia (decisión clave)

El arbitraje real **no** compra en el exchange A y transfiere BTC on-chain al exchange B en cada operación: la liquidación on-chain de Bitcoin tarda ~10–60 min y mataría cualquier oportunidad. Las mesas reales **pre-posicionan capital en ambos venues** y rebalancean ocasionalmente.

Por eso el sistema usa el **modelo de inventario**: comprar en A debita USD de A y acredita BTC en A; vender en B debita BTC de B y acredita USD en B. Los balances **se desvían con el tiempo** (A acumula BTC, B acumula USD), y el sistema **muestra esa desviación** en lugar de esconderla tras la ficción de transferencias instantáneas.

### 5.4 Costo de retiro: amortizado, no por operación

El error clásico es restar el *withdrawal fee* en **cada** operación; eso descartaría oportunidades reales, porque bajo el modelo de inventario no se mueve BTC on-chain en cada trade. El retiro es un **costo de rebalanceo**: solo se paga cuando la desviación de inventario de un venue supera un umbral (`REBALANCE_THRESHOLD_BTC`) y obliga a una transferencia on-chain hacia el venue más drenado.

Cuando eso ocurre, `Portfolio` mueve el excedente de BTC al venue depletado, liquida la pata de USD internamente, y **cobra solo la comisión de red** (el `withdrawalFeeBtc` del venue, valuado a precio de referencia) como costo real de P&L. Ese costo total se **amortiza entre las operaciones ejecutadas** y se muestra en el dashboard como **"costo de rebalanceo / operación"** — la forma honesta y correcta de incorporar el requisito de *withdrawal fees* sin penalizar cada trade.

---

## 6. Gestión de riesgo

`RiskManager` se sitúa entre "detectado" y "ejecutado". Rechaza una oportunidad cuando:

- **Feed obsoleto:** alguno de los books supera `maxQuoteAgeMs` (no operamos sobre precios viejos).
- **Spread inverosímil:** un cruce más ancho que `maxSaneSpreadPct` casi siempre es un *glitch* de datos, no dinero gratis.
- **Por debajo del mínimo:** la ganancia neta es menor a `minNetProfitUsd`.

Las oportunidades de cruce bruto que **no** sobreviven las comisiones se emiten igualmente como **rechazadas** (con su motivo), de modo que el dashboard muestra el motor evaluando y descartando — la narrativa de "bruto vs neto".

---

## 7. Simulador de ejecución y portafolio

`ExecutionSimulator` ejecuta contra los books **vigentes al momento de ejecutar** (no el snapshot de detección — el mercado pudo moverse), y maneja **llenados parciales** cuando la profundidad del book o el balance de la wallet no cubren el tamaño completo.

`Portfolio` lleva los balances simulados por exchange y deriva el P&L: P&L realizado, equity marcado a mercado, tasa de acierto y la **curva de equity** para graficar.

---

## 8. Latencia: cómo se mide

Cada detección marca tres instantes:

| Símbolo | Significado |
|---------|-------------|
| `t0` | tiempo del evento del exchange (cuando el payload lo incluye) |
| `t1` | tiempo de recepción local del mensaje WS |
| `t2` | tiempo de detección de la oportunidad |

- **Latencia de procesamiento** = `t2 − t1`: puramente nuestro código, independiente del desfase de relojes. Es el número que **controlamos y optimizamos**; se muestra en vivo como p50 / p95 / p99.
- **Latencia de feed** = `t1 − t0`: red + exchange, indicativa.

Optimizaciones en la ruta caliente: estado plano en memoria, nada bloqueante en el handler de mensajes, persistencia/estadísticas agregadas fuera de la ruta caliente (temporizador de 500 ms), y en el navegador los books de alta frecuencia se almacenan en buffer y se vuelcan en `requestAnimationFrame`.

---

## 9. Arbitraje triangular

El arbitraje triangular es intrínsecamente de **un solo exchange**: las tres patas deben ejecutarse en el mismo libro, así que no tiene sentido mezclar precios entre venues. Por eso se instancia un `TriangularEngine` **independiente por cada venue configurado** (por defecto Binance, OKX, Bybit, KuCoin y Gate.io), cada uno con sus propios tres connectors para `BTC/USDT`, `ETH/BTC` y `ETH/USDT`. Estos connectors alimentan **solo** al motor triangular y nunca entran al flujo de books cross-exchange. Cada motor evalúa ambas direcciones sobre un nominal fijo:

- **Forward:** `USDT → BTC → ETH → USDT`
- **Reverse:** `USDT → ETH → BTC → USDT`

Cada vuelta aplica tres *taker fees*. En un mercado eficiente el resultado neto ronda −0.3% en venues de 0.1% (exactamente el arrastre de 3 × 0.1%) y más negativo donde la comisión es mayor (p. ej. Gate.io a 0.2% ronda −0.6%), lo cual el dashboard muestra honestamente por venue: la estrategia funciona y se ve **por qué** el ciclo no supera las comisiones.

---

## 10. Modo demo / replay

Como los arbitrajes netos positivos reales entre venues importantes son prácticamente inexistentes, un demo puramente en vivo mostraría un blotter (honestamente) vacío. Para demostrar la ruta de ejecución completa existe un **modo demo claramente etiquetado**:

- Un venue sintético `demo` cotiza alrededor del precio de referencia en vivo e inyecta dislocaciones breves y realistas, suficientes para superar las comisiones de ida y vuelta.
- Todo lo demás es el motor real: detección, net-profit por profundidad, riesgo, simulador, portafolio.
- Es **imposible confundirlo con datos reales**: se muestra un banner permanente y el venue se llama `demo`.

El book dislocado del venue demo se **excluye** del precio de referencia de marcado a mercado, para no distorsionar el equity. Se activa/desactiva en vivo desde el dashboard.

---

## 11. Decisión de runtime (Node, no Bun)

El servidor se ejecuta en **Node** (`tsx` en desarrollo, Node puro en producción), no en Bun. Durante el desarrollo se detectó que las **emisiones broadcast de `socket.io` son poco confiables bajo el runtime actual de Bun**: el cliente recibía el estado inicial y luego nada. Bajo Node, el stream funciona correctamente. Además se emite **por socket** (iterando los clientes) en lugar de `io.emit`, lo cual es equivalente para un único namespace y evita por completo la rareza del broadcast.

La instalación y la orquestación de tareas siguen usando **Bun workspaces**; solo el proceso del servidor corre en Node.

---

## 12. Entrega en tiempo real

- **Servidor → cliente:** Socket.IO, emitiendo a cada socket conectado.
- **Books de alta frecuencia:** el cliente los almacena en buffer y los vuelca por *frame* (`requestAnimationFrame`), de modo que el navegador nunca se convierte en el cuello de botella: se registran todos los eventos pero se renderiza a ~60 fps.
- **Estadísticas agregadas** (portafolio, latencia): se empujan en una cadencia fija de 500 ms, fuera de la ruta caliente.

---

## 13. Compromisos y trabajo futuro

- **Profundidad del triangular:** hoy usa *top-of-book* sobre un nominal fijo (el estándar para detectar el edge); un *depth walk* de tres patas sería el siguiente paso.
- **Persistencia:** el historial vive en memoria; una base de datos (p. ej. MongoDB) permitiría histórico entre sesiones.
- **Más pares y monedas de cotización:** ya corremos 8 venues en dos *pools* (USDT/USD); la abstracción de connectors hace trivial sumar exchanges, y generalizar a más símbolos (p. ej. pools USDC) ampliaría el universo de oportunidades.
- **Colocación:** desplegar el servidor en una región cercana al *edge* de los exchanges reduciría la latencia de feed (RTT).
