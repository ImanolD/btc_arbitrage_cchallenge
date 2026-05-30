# Criterios del jurado — cómo los resolvemos

Este documento mapea **cada criterio de evaluación** del reto a las decisiones concretas de nuestra solución, con punteros al código para que la revisión sea directa. Al final hay un **FAQ** que anticipa las preguntas técnicas más probables.

> Resumen en una línea: este reto *parece* un problema de velocidad, pero se gana con **criterio financiero**. Optimizamos latencia **y** modelamos el dominio (inventario, slippage, fees amortizados, riesgo) como lo hace una mesa real.

---

## Recorrido de 3 minutos para el jurado

Una ruta guiada para ver toda la solución en vivo, de lo real a lo demostrativo:

1. **(~30 s) Datos en vivo.** Abre el dashboard. Mira el **panel de mercado**: 8 exchanges transmitiendo bid/ask por WebSocket en tiempo real, agrupados por moneda de cotización (USDT / USD). El **panel de latencia** muestra la latencia de procesamiento p50/p95/p99 — el número que controlamos.
2. **(~45 s) Bruto vs neto.** Mira el **feed de oportunidades**. Verás cruces marcados **SKIP** con su motivo: el cruce existía en bruto pero **no sobrevive las comisiones**. Esto demuestra que el cálculo neto es correcto y que no "imprimimos dinero" falso. Es esperable que el blotter en vivo esté tranquilo: el arbitraje limpio entre venues importantes es raro.
3. **(~60 s) Ruta de ejecución completa (modo demo).** Activa el **modo demo** (botón en la barra superior; banner permanente, venue `demo` claramente etiquetado). Inyecta dislocaciones realistas que superan las comisiones, así que verás: oportunidades **EXEC**, llenados parciales en el **blotter**, la **curva de equity** moverse, los **balances por wallet** desviarse, y — tras suficiente desviación — un **rebalanceo** que cobra el withdrawal fee amortizado (KPI "costo de rebalanceo / operación").
4. **(~30 s) Priorización + triangular.** Nota la oportunidad **"mejor ejecutable ahora"** resaltada (ejecutamos por mayor ganancia neta, no la primera). Abre el **panel triangular**: ciclos `USDT→BTC→ETH→USDT` en 5 venues, ambas direcciones, netos de tres fees.
5. **(~15 s) Código.** Todo está tipado de punta a punta (`packages/shared`) y los feeds son **públicos y sin API keys** — el repo corre tal cual. Ver la tabla de abajo para el mapeo criterio↔archivo.

---

## Tabla resumen

| # | Criterio | Cómo lo resolvemos | Evidencia |
|---|----------|--------------------|-----------|
| 1 | **Velocidad / latencia** | WebSockets en 8 venues, motor dirigido por eventos O(N)/tick, latencia de procesamiento medida p50/p95/p99 | `engine/arbitrageEngine.ts`, `engine/latencyTracker.ts`, `exchanges/*` |
| 2 | **Precisión de rentabilidad neta** | *Depth-walk* nivel por nivel (slippage real), taker fees por trade, withdrawal fees **amortizados** por rebalanceo, agrupación por moneda de cotización | `engine/profit.ts`, `config.ts`, `engine/portfolio.ts` |
| 3 | **Solidez / robustez** | Órdenes parciales, *circuit breakers* (feed obsoleto, spread inverosímil, mínimo neto), reconexión con *backoff* | `engine/executionSimulator.ts`, `engine/riskManager.ts`, `exchanges/base.ts` |
| 4 | **Estrategia / inteligencia** | 8 exchanges en 2 *pools* de cotización + **arbitraje triangular** en 5 venues, **priorización** por ganancia neta | `engine/arbitrageEngine.ts`, `engine/triangularEngine.ts` |
| 5 | **Arquitectura / código** | Monorepo tipado de punta a punta (tipos compartidos), connectors enchufables, documentación | `packages/shared`, `exchanges/`, `docs/ARCHITECTURE.md` |
| 6 | **Experiencia / UI** | Terminal de trading en vivo (React + shadcn/ui), KPIs, feed bruto-vs-neto, blotter, equity, latencia, triangular, modo demo | `apps/web/src/*` |

---

## 1. Velocidad y eficiencia en la detección

**Qué pide el jurado:** ¿con qué latencia identificas una divergencia desde que ocurre? ¿WebSockets o polling? ¿cómo optimizas el procesamiento en tiempo real?

**Cómo lo resolvemos:**

- **WebSockets, nunca polling.** Cada exchange mantiene una conexión persistente con *heartbeat* y reconexión automática (`exchanges/base.ts`). Recibimos el order book apenas el exchange lo emite.
- **Dirigido por eventos, no por temporizador.** El motor reevalúa en **cada tick** de book. Cuando llega un book del exchange X, solo se reverifican los pares que **involucran a X** — costo **O(N) por actualización**, no O(N²) sobre todo el producto cruzado (`arbitrageEngine.ts → onBook`).
- **Medición honesta de latencia.** Marcamos tres instantes: `t0` (evento del exchange), `t1` (recepción local), `t2` (detección). La **latencia de procesamiento** = `t2 − t1` es la que controlamos y la mostramos en vivo como **p50 / p95 / p99** (`latencyTracker.ts`). Es independiente del desfase de relojes entre nuestra máquina y el exchange.
- **Ruta caliente optimizada:** estado plano en memoria, nada bloqueante en el handler de mensajes, y las estadísticas agregadas se empujan en cadencia fija (cada 500 ms) **fuera** de la ruta caliente.

**Diferenciador:** distinguimos latencia de **procesamiento** (lo que controlamos) de latencia de **feed** (red + exchange), en vez de reportar un único número engañoso.

---

## 2. Precisión en el cálculo de rentabilidad neta

**Qué pide el jurado:** ¿consideras correctamente fees, slippage y riesgos antes de decidir? ¿Evitas operar lo que se ve rentable en bruto pero es negativo en neto?

**Cómo lo resolvemos:**

- **Slippage real por *depth-walk*.** `computeArbitrage` (`engine/profit.ts`) recorre ambos books nivel por nivel, acumulando tamaño mientras el llenado marginal siga siendo rentable **después de comisiones**, y se detiene en cuanto `ask × (1+fee) ≥ bid × (1−fee)`. Nunca asumimos que el mejor precio llena todo el tamaño.
- **Taker fees por exchange** (`config.ts → feeModels`), aplicados sobre el costo de compra y el ingreso de venta.
- **Withdrawal fees amortizados, no por operación.** Bajo el modelo de inventario no se mueve BTC on-chain en cada trade; el retiro es un **costo de rebalanceo**. Lo cobramos solo cuando la desviación de inventario supera un umbral y lo **amortizamos entre las operaciones** (`engine/portfolio.ts`). Restarlo en cada trade descartaría oportunidades reales — un jurado técnico lo notaría.
- **Agrupación por moneda de cotización.** Solo comparamos venues que cotizan el mismo activo (USDT vs USD). Cruzar BTC/USD con BTC/USDT surgiría un "arbitraje" que en realidad es riesgo del *peg* de USDT, no un spread libre (`exchanges/symbols.ts`).
- **Surfacing de rechazados.** Los cruces brutos que **no** sobreviven las comisiones se emiten igualmente, marcados como rechazados con su motivo — el dashboard muestra la narrativa **bruto vs neto**.

**Diferenciador:** mostramos *por qué* rechazamos una oportunidad, demostrando que el cálculo neto es correcto en vez de "imprimir dinero".

---

## 3. Solidez y robustez de la lógica de negocio

**Qué pide el jurado:** ¿cómo manejas baja liquidez, órdenes parciales o movimientos bruscos? ¿hay gestión de riesgo o circuit breaker?

**Cómo lo resolvemos:**

- **Órdenes parciales.** El simulador ejecuta contra los books **vivos al momento de ejecución** (no el snapshot de detección — el mercado pudo moverse) y llena parcialmente cuando la profundidad o el balance de wallet no cubren el tamaño completo (`engine/executionSimulator.ts`).
- **Circuit breakers** (`engine/riskManager.ts`), la compuerta entre "detectado" y "ejecutado":
  - **Feed obsoleto:** nunca operamos sobre una cotización más vieja que `maxQuoteAgeMs`.
  - **Spread inverosímil:** un spread más ancho que `maxSaneSpreadPct` casi siempre es dato erróneo, no dinero gratis → se rechaza.
  - **Mínimo neto:** por debajo de `minNetProfitUsd` no se ejecuta.
- **Capital limitado por inventario:** el tamaño se acota por el USD disponible en el lado de compra y el BTC disponible en el lado de venta.
- **Cooldown por ruta** para no spamear ejecuciones sobre el mismo par.
- **Reconexión robusta:** *backoff* exponencial acotado por conexión caída (`exchanges/base.ts`).

**Diferenciador:** la mayoría de los equipos omite la gestión de riesgo; el jurado la pide explícitamente y nosotros la tenemos como módulo de primera clase.

---

## 4. Estrategia e inteligencia del bot

**Qué pide el jurado:** ¿detecta la primera oportunidad o prioriza, compara múltiples pares e implementa estrategias más sofisticadas (triangular, etc.)?

**Cómo lo resolvemos:**

- **8 exchanges en paralelo**, en 2 *pools* de cotización (USDT: Binance, Kraken, OKX, Bybit, KuCoin, Gate.io · USD: Bitstamp, Bitfinex). Todos con feeds **públicos y sin API keys**.
- **Arbitraje triangular** independiente en 5 venues sobre `BTC/USDT · ETH/BTC · ETH/USDT`, evaluando ambas direcciones del ciclo netas de tres taker fees (`engine/triangularEngine.ts`). Es intrínsecamente de un solo exchange (las tres patas se ejecutan en el mismo libro), por eso corre por venue.
- **Priorización por ganancia neta:** en cada tick recolectamos todas las rutas candidatas y **ejecutamos las accionables de mayor a menor neto**, asignando el capital escaso a la mejor primero — no "la primera que aparece". El dashboard resalta la "mejor ejecutable ahora" (`arbitrageEngine.ts`).

**Diferenciador:** combinamos arbitraje cross-exchange multi-venue **y** triangular multi-venue, con priorización explícita.

---

## 5. Calidad de la arquitectura y el código

**Qué pide el jurado:** ¿está bien estructurado, es mantenible y escalable? ¿código legible, documentado y con buenas prácticas?

**Cómo lo resolvemos:**

- **Monorepo** con `packages/shared` como **única fuente de verdad** del contrato servidor↔cliente: los payloads de cada evento Socket.IO están tipados de punta a punta, así un cambio incompatible falla en compilación.
- **Connectors enchufables:** cada exchange es una subclase de `BaseConnector`; agregar un venue es **un archivo nuevo + una línea en el registro**. Un helper `parsePair` traduce un símbolo genérico al formato propio de cada venue.
- **Separación de responsabilidades:** connectors → store → motor (profit / risk / ejecución / portfolio / latencia) → transporte → UI.
- **Documentación:** `README.md` (uso + decisiones) y `docs/ARCHITECTURE.md` (diseño detallado), ambos en español.

**Diferenciador:** tipos compartidos de punta a punta y una abstracción de connectors que escaló de 4 a 8 venues sin tocar el motor.

---

## 6. Experiencia y presentación en la interfaz web

**Qué pide el jurado:** web app desplegada y funcional; se valora visualizar mercado, oportunidades, operaciones y P&L en tiempo real.

**Cómo lo resolvemos:** terminal de trading en vivo (Vite + React + **shadcn/ui** + Recharts), con:

- **KPIs** (P&L realizado, equity *mark-to-market*, trades, oportunidades accionables, win rate, **costo de rebalanceo / operación**).
- **Panel de mercado** con bid/ask por venue, columna de moneda y mejor *cross edge* por *pool*.
- **Feed de oportunidades** bruto vs neto, con verdict EXEC/SKIP y la mejor ejecutable resaltada.
- **Blotter** de operaciones, **curva de equity**, **panel de latencia** y **panel triangular** multi-venue.
- **Modo demo/replay** claramente etiquetado para mostrar la ruta de ejecución completa.

---

## FAQ — preguntas que el jurado podría hacer

**¿Por qué no compran BTC en un exchange y lo transfieren a otro para vender?**
Porque eso no es rentable en la práctica: la liquidación on-chain de BTC tarda ~10–60 min y la oportunidad desaparece mucho antes. Las mesas reales usan **capital pre-posicionado** (modelo de inventario): ya tienen USDT en el venue barato y BTC en el venue caro, y compran/venden **simultáneamente** sin mover monedas.

**Entonces, ¿cómo consideran el *withdrawal fee*, que el reto pide explícitamente?**
Como un **costo de rebalanceo amortizado**, no por operación. Cobramos el fee de red solo cuando el inventario se desvía lo suficiente como para requerir una transferencia on-chain, y repartimos ese costo entre todas las operaciones. Lo mostramos como "costo de rebalanceo / operación". Restarlo en cada trade sería un error de modelado que descartaría oportunidades reales.

**¿Por qué a veces el blotter en vivo tiene pocas operaciones?**
Porque el arbitraje limpio de BTC entre venues importantes es **raro y de poca profundidad** — los mercados eficientes cierran esas brechas en milisegundos. Un sistema honesto muestra *pocas pero genuinamente positivas* y rechaza las falsas. Para demostrar la ruta de ejecución completa existe el **modo demo**.

**¿El modo demo es hacer trampa?**
No. Es un venue sintético **claramente etiquetado** (`demo`, con banner permanente) que inyecta dislocaciones realistas para ejercitar todo el pipeline (llenados parciales, desviación de inventario, P&L, curva de equity). Es imposible confundirlo con datos reales, y su book dislocado se **excluye** del precio de referencia de marcado a mercado.

**¿Cómo miden la latencia si el reloj del exchange y el suyo no están sincronizados?**
Separamos **latencia de procesamiento** (`t2 − t1`, puramente nuestro código, inmune al desfase de relojes) de **latencia de feed** (`t1 − t0`, red + exchange, indicativa). El número que controlamos y optimizamos es el de procesamiento, reportado como p50/p95/p99.

**¿Por qué separan venues USD y USDT?**
Porque un book BTC/USD y uno BTC/USDT difieren por el *peg* de USDT. Cruzarlos surgiría un "arbitraje" que en realidad es riesgo cambiario, no un spread libre. El motor solo compara venues con la **misma moneda de cotización**.

**¿Por qué el arbitraje triangular corre por venue y no entre exchanges?**
Porque las tres patas del ciclo deben ejecutarse en el **mismo libro** para ser atómicas; mezclar precios de exchanges distintos no sería ejecutable. Por eso instanciamos un motor triangular independiente por venue.

**¿Por qué corren el servidor en Node y no en Bun?**
Usamos Bun para *workspaces* y tareas, pero el **proceso del servidor corre en Node**: bajo el runtime actual de Bun los *broadcasts* de Socket.IO resultaron poco confiables. Es una decisión pragmática, documentada en `ARCHITECTURE.md`.

**¿Cómo escalaría a más exchanges o pares?**
La abstracción de `BaseConnector` hace que sumar un venue sea un archivo + una línea. Pasamos de 4 a 8 venues sin tocar el motor. Generalizar a más símbolos o *pools* (p. ej. USDC) es directo.

**¿El P&L es real?**
Es **simulado** (como pide el reto): ejecución contra books reales en vivo, con llenados parciales y balances por wallet actualizados, marcado a mercado contra el precio de referencia. No se envían órdenes reales.

**¿Qué pasa si el mercado se mueve durante la ejecución?**
El simulador ejecuta contra los books **vivos al momento de ejecutar**, no contra el snapshot de detección, y llena parcialmente si la liquidez cambió. Si ya no es rentable, no ejecuta.
