# Arquitectura — Filobot (Terminal de Arbitraje BTC)

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

### 5.3 Decisión por valor esperado (EV)

La mayoría de los bots disparan con una regla de umbral: "si el spread neto > X, ejecuta". Nosotros disparamos por **valor esperado**, que es como razona una mesa real: un *edge* delgado visto sobre una cotización vieja probablemente se cierre antes de que ejecutemos.

`expectedValue.ts` estima primero la **probabilidad de supervivencia** del cruce dentro de nuestra ventana de latencia, con una **heurística transparente** (no una caja negra de ML) sobre features de microestructura reales:

```
supervivencia ≈ decay(edad) · confianza_edge(neto%) · soporte_liquidez(imbalance)
EV            = supervivencia · neto − (1 − supervivencia) · costo_adverso
```

- **decay(edad):** `exp(−edad / τ)` — cotizaciones frescas sobreviven mejor (τ por defecto 400 ms; edad = latencia de feed + procesamiento).
- **confianza_edge:** un *edge* más grande es menos probable que sea ruido que revierte.
- **soporte_liquidez:** *imbalance* del order book (profundidad de soporte en ambas patas) — más profundidad hace el cruce menos efímero. El *order-book imbalance* es uno de los predictores de microestructura mejor documentados.
- **costo_adverso:** pérdida esperada si quedamos llenos en una pata y debemos deshacer la otra a peor precio (`EV_ADVERSE_BPS` del nominal).

Una oportunidad debe pasar la compuerta de riesgo **y** tener `EV > EV_MIN_USD`. La ejecución se **prioriza por EV descendente**. El dashboard muestra **P(supervivencia)** y **EV** por oportunidad — convirtiendo la decisión en algo legible y defendible.

> **IA — postura explícita:** *ML clásico/heurística para el alfa, nunca un LLM en el hot path.* El modelo de EV es ligero, determinista y vive en la ruta caliente; cualquier capa de lenguaje natural (explicar decisiones) va **fuera** del hot path — exactamente lo que hace **Filo** (§11). El reto premia esta madurez de criterio.

### 5.4 Modelo de inventario vs. transferencia (decisión clave)

El arbitraje real **no** compra en el exchange A y transfiere BTC on-chain al exchange B en cada operación: la liquidación on-chain de Bitcoin tarda ~10–60 min y mataría cualquier oportunidad. Las mesas reales **pre-posicionan capital en ambos venues** y rebalancean ocasionalmente.

Por eso el sistema usa el **modelo de inventario**: comprar en A debita USD de A y acredita BTC en A; vender en B debita BTC de B y acredita USD en B. Los balances **se desvían con el tiempo** (A acumula BTC, B acumula USD), y el sistema **muestra esa desviación** en lugar de esconderla tras la ficción de transferencias instantáneas.

### 5.5 Costo de retiro: amortizado, no por operación

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

## 11. Filo: copiloto conversacional (IA fuera del hot path)

**Filo** es la voz conversacional del bot — la realización concreta de la postura de IA de §5.3: el lenguaje natural **interpreta y narra**, pero **nunca decide trades** ni entra en la ruta caliente. (El nombre es por la gata del autor; ver `whyfilo.md`.)

### 11.1 Una sola mente, agnóstica al transporte

`FiloAgent` (`apps/server/src/filo/filoAgent.ts`) es un `EventEmitter` que se **suscribe a los eventos del motor** (`opportunity`, `trade`, `portfolio`, `latency`, `stats`) y mantiene una vista viva del estado. Emite mensajes que el servidor reenvía por **Socket.IO** y responde preguntas a demanda. El "cerebro" no sabe nada del transporte: alimenta **dos** consumidores de la misma mente — el dashboard (Socket.IO) y **WhatsApp** (§11.5).

### 11.2 Dos capas, con degradación elegante

1. **Determinista primero.** Un *matcher* de intención por palabras clave responde las preguntas frecuentes (P&L, equity, oportunidades, latencia, mejor trade, rebalanceo, supervivencia, venues, "por qué descartaste") **construyendo la respuesta con los números reales del motor**. Es instantáneo, sin costo, siempre disponible y bilingüe (ES/EN).
2. **LLM opcional (Claude), estrictamente *grounded*.** Para preguntas libres que el *matcher* no cubre, `llm.ts` consulta a Claude con un *system prompt* que le ordena **usar solo el estado en JSON que le pasamos y nunca inventar cifras**. Tiene timeout duro (7 s) y, ante cualquier fallo (sin API key, error de red, timeout), **cae de vuelta a la respuesta determinista**: la demo nunca depende de una llamada remota. La capa se activa solo si existe `ANTHROPIC_API_KEY`.

Las respuestas que vienen del LLM se marcan con una insignia **"AI"** en el chat, para ser transparentes sobre su origen.

### 11.3 Narración dirigida por eventos (no spam)

Filo narra lo **relevante**, no cada tick: mejor oportunidad accionable, ejecuciones (agregadas), un descarte ilustrativo (bruto positivo / neto negativo), cambio de modo demo, caída de feed, y un **resumen periódico** de la sesión. Cada categoría tiene su propio *throttle*, de modo que en modo en vivo (donde casi nada es accionable) Filo refuerza la narrativa honesta, y en modo demo cobra vida.

### 11.4 Por qué esto suma (y no es teatro)

La parte que gana puntos no es "tenemos un chatbot", sino **explicabilidad grounded**: Filo puede decir *por qué* se descartó un cruce (bruto vs neto vs EV) en lenguaje llano, conectando la sofisticación financiera del motor con un jurado no técnico — sin arriesgar la corrección, porque las cifras salen del motor, no del modelo.

### 11.5 Filo por WhatsApp (segundo transporte, también fuera del hot path)

El cerebro agnóstico al transporte (§11.1) alimenta un segundo canal vía [Kapso](https://kapso.ai): `WhatsAppBridge` (`apps/server/src/filo/whatsappBridge.ts`).

- **Opt-in por click-to-chat.** El visitante toca un enlace `wa.me` y envía una palabra clave. Eso (1) da **consentimiento**, (2) abre la **ventana de servicio de 24 h** de WhatsApp (requisito de Meta para mensajes libres; evita depender de plantillas pre-aprobadas) y (3) lo registra. El webhook entrante se **verifica por firma HMAC-SHA256**.
- **Salida throttled.** Las narraciones de Filo se reenvían a los suscriptores activos, **limitadas por persona** y solo dentro de la ventana de 24 h.
- **Entrada → mismo cerebro.** Las preguntas por WhatsApp pasan por el mismo `ask()` (determinista + LLM opcional) que el dashboard. `BAJA`/`STOP` cancela.
- **Persistencia opcional y aislada.** Las suscripciones se guardan tras una interfaz `Storage` (`apps/server/src/storage/`): Mongo si hay `MONGODB_URI`, en memoria si no (clean-room). Una conexión fallida **degrada a memoria** sin tumbar el dashboard.
- **Fuera del hot path.** Igual que el LLM: ningún envío de WhatsApp ni escritura a Mongo es síncrono respecto a la detección/ejecución. Todo es *fire-and-forget* y tolerante a fallos.

---

## 12. Decisión de runtime (Node, no Bun)

El servidor se ejecuta en **Node** (`tsx` en desarrollo, Node puro en producción), no en Bun. Durante el desarrollo se detectó que las **emisiones broadcast de `socket.io` son poco confiables bajo el runtime actual de Bun**: el cliente recibía el estado inicial y luego nada. Bajo Node, el stream funciona correctamente. Además se emite **por socket** (iterando los clientes) en lugar de `io.emit`, lo cual es equivalente para un único namespace y evita por completo la rareza del broadcast.

La instalación y la orquestación de tareas siguen usando **Bun workspaces**; solo el proceso del servidor corre en Node.

---

## 13. Entrega en tiempo real

- **Servidor → cliente:** Socket.IO, emitiendo a cada socket conectado.
- **Books de alta frecuencia:** el cliente los almacena en buffer y los vuelca por *frame* (`requestAnimationFrame`), de modo que el navegador nunca se convierte en el cuello de botella: se registran todos los eventos pero se renderiza a ~60 fps.
- **Estadísticas agregadas** (portafolio, latencia): se empujan en una cadencia fija de 500 ms, fuera de la ruta caliente.

---

## 14. Compromisos y trabajo futuro

- **Profundidad del triangular:** hoy usa *top-of-book* sobre un nominal fijo (el estándar para detectar el edge); un *depth walk* de tres patas sería el siguiente paso.
- **Persistencia:** el historial vive en memoria; una base de datos (p. ej. MongoDB) permitiría histórico entre sesiones.
- **Más pares y monedas de cotización:** ya corremos 8 venues en dos *pools* (USDT/USD); la abstracción de connectors hace trivial sumar exchanges, y generalizar a más símbolos (p. ej. pools USDC) ampliaría el universo de oportunidades.
- **Colocación:** desplegar el servidor en una región cercana al *edge* de los exchanges reduciría la latencia de feed (RTT).
- **Filo por WhatsApp — implementado (§11.5).** El siguiente paso natural sería re-enganche fuera de la ventana de 24 h con **plantillas pre-aprobadas** de Meta y *broadcasts* segmentados, para avisar a un suscriptor cuando ya pasó un día desde su último mensaje.
