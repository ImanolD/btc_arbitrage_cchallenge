# Fase final — novedades (Filobot)

> En las rondas anteriores **describí** cómo un sistema de arbitraje real maneja
> los detalles finos: fills parciales, patas fallidas, la vuelta a plano, el
> rebalanceo de inventario tipo (s,S) y — sobre todo — la **parametrización**
> profunda que separa a un bot de demo de una mesa de verdad. En esta fase final
> el objetivo es **cerrar el loop: construir lo que dije, y hacerlo tocable en la
> UI.** No es teoría; se puede mover con el dedo y ver reaccionar al sistema en
> vivo.

Este documento resume, en orden, **qué cambió** respecto a la versión de las
rondas anteriores. Es complementario al [`README.md`](../README.md) (visión
general) y a [`judging_criteria.md`](judging_criteria.md) (mapeo criterio↔código).

---

## ✅ Enviado — Centro de parametrización en vivo

El comité subrayó, con sus propias palabras, que *"el grado de profundidad con el
que parametricen las distintas opciones será uno de los factores que MÁS
diferencie a los proyectos"*, y preguntó explícitamente si el usuario puede
ajustar **umbrales, fees, tamaños de orden y exchanges activos**.

Respuesta: sí, los cuatro — y bastante más — **desde la UI, en vivo, sin
reiniciar**. El panel de **Parámetros** pasó de ~6 controles sueltos a un centro de
parametrización **agrupado por sección**, encabezado por un contador de
`N controles en vivo` (31 con la configuración por defecto de 8 venues; crece con
cada venue añadido).

Además, el panel dejó de ser un **modal que tapa el dashboard** y ahora es un
**drawer lateral persistente**: en desktop se ancla a la derecha y el contenido se
recorre para no quedar oculto, de modo que puedes **ajustar un parámetro y ver
reaccionar el feed y el P&L al instante, sin cerrar nada** (en móvil cae a
bottom-sheet). El disparador ya no es el críptico botón "EV": es un control
**"Parámetros"** resaltado, con un chip del modo activo (EV/Spread) y un badge con
el contador de controles en vivo.

### Qué se puede ajustar ahora

| Sección | Controles | ¿Nuevo en esta fase? |
|---|---|---|
| **Presets** | Conservador · Balanceado · Agresivo · Mesa/MM (aplican un *bundle* completo de un clic) | ✅ nuevo |
| **Estrategia** | Modo de decisión EV ↔ spread, ganancia neta mínima | reorganizado |
| **Valor esperado (EV)** | `τ` de latencia, costo adverso, EV mínimo | reorganizado |
| **Tamaño y capital** | Nominal máximo por pata (`maxNotionalUsd`) | ✅ **nuevo — lo piden explícito** |
| **Riesgo y guardas** | Spread máximo (anti-glitch), antigüedad máxima de quote | ✅ **nuevo** |
| **Rebalanceo** | Umbral de drift en BTC que dispara la transferencia on-chain | ✅ **nuevo** |
| **Fees por exchange** | Taker fee editable **por cada venue** | ✅ **nuevo — lo piden explícito** |
| **Exchanges activos** | Toggle por venue: incluir/excluir del arbitraje (el feed sigue vivo) | ✅ **nuevo — lo piden explícito** |
| **Filo** | Cadencia del resumen, silenciar/activar narraciones | ya existía |

### Presets de estrategia

Un clic reconfigura toda la postura de riesgo, para que un juez pueda "jugar" y
ver el comportamiento cambiar al instante:

- **Conservador** — EV alto, size chico, guards estrictos, rebalanceo tardío.
- **Balanceado** — los valores por defecto del servidor.
- **Agresivo** — size grande, EV mínimo, guards laxos, rebalanceo temprano.
- **Mesa / MM** — modo spread, inventario ajustado, guarda de quote estricta.

### Cómo funciona por dentro

- Los nuevos campos viven en el **contrato de datos compartido**
  (`packages/shared/src/index.ts`): `EngineConfig` gana `fees` (por venue),
  `rebalanceThresholdBtc` y `disabledExchanges`; `EngineConfigPatch` acepta
  `maxNotionalUsd`, `maxSaneSpreadPct`, `maxQuoteAgeMs`, `rebalanceThresholdBtc`,
  `fees` (parcial, por venue) y `disabledExchanges`.
- El servidor **valida y acota** cada patch antes de aplicarlo
  (`apps/server/src/index.ts` → `applyConfigPatch`): cada valor se *clampa* a un
  rango sano (p. ej. taker fee ∈ [0, 5%], size ∈ [$100, $10M]) y luego se
  **reemite por Socket.IO** a todos los clientes. Ningún valor del cliente entra
  crudo al motor.
- `feeModels` y el umbral de rebalanceo se enlazan al `engineConfig` **por
  referencia** (`apps/server/src/config.ts`): una sola fuente de verdad alimenta
  el motor, el simulador, el portafolio **y** la config que ve el dashboard, sin
  duplicar estado.
- El motor respeta los venues desactivados en caliente
  (`arbitrageEngine.ts`: un venue en `disabledExchanges` deja de participar en la
  comparación y la ejecución, pero **su feed sigue transmitiendo** en el panel de
  mercado) y el portafolio lee el umbral y los fees **vivos** desde la config
  (`portfolio.ts`), no desde constantes de arranque.
- Toda la UI nueva está internacionalizada ES/EN (`apps/web/src/lib/i18n.tsx`).

### Prueba de 60 segundos (para el jurado)

1. Abre **Parámetros** (botón resaltado en la barra de estado, con el chip de modo
   EV/Spread y el badge del contador). Se abre como **drawer lateral persistente**:
   déjalo abierto y ve reaccionar el feed/P&L mientras ajustas. Fíjate en el
   contador `N controles en vivo` arriba.
2. En **Fees por exchange**, sube el taker fee de un venue a un valor alto:
   verás en el feed cómo cruces que antes pasaban ahora quedan en `SKIP` (neto
   negativo). Bájalo a `0` y reaparecen.
3. En **Exchanges activos**, apaga 2–3 venues: dejan de aparecer en las
   oportunidades, pero **siguen transmitiendo** en el panel de mercado.
4. Sube el **tamaño de orden** y cambia a **modo spread**: el P&L y el ritmo de
   ejecución reaccionan en vivo.
5. Aplica el preset **Agresivo** y luego **Conservador**: observa cómo cambia de
   personalidad de golpe.

Todo lo anterior se propaga a cualquier otra pestaña abierta del dashboard al
instante — es estado de servidor, no local.

---

## ✅ Enviado — Robustez demostrable: máquina de estados + inyector de escenarios

El comité preguntó, textual: *"¿Cómo se comporta tu bot cuando una orden falla,
cuando la liquidez es insuficiente o cuando el mercado se mueve bruscamente
durante la ejecución?"*. En vez de responderlo por escrito (otra vez), ahora se
puede **disparar el fallo y ver al bot manejarlo**.

### Máquina de estados por pata + vuelta a plano

Cada ejecución se modela como **dos patas independientes** (compra y venta),
cada una con su propio estado: `filled` · `partial` · `rejected`. Cuando las
patas no coinciden — una se rechaza, o la liquidez/gap solo llena un lado —
queda un **residual direccional** (Δ en BTC), y el motor **vuelve a plano** de
una de dos formas, eligiendo la más barata por precio:

- **Re-hedge (completar):** ejecuta la pata faltante en el venue contraparte —
  captura la intención del arb a un precio peor/incierto.
- **Unwind (deshacer):** revierte la pata que sí llenó en el venue que acabamos
  de tocar — renuncia al arb con tal de quedar plano.

En ambos casos la prioridad es **no quedarse con exposición direccional abierta**,
exactamente como lo describí en las rondas anteriores. La contabilidad es exacta:
el simulador calcula los **deltas por wallet** de las dos patas + la resolución,
el BTC se conserva a plano, y el P&L realizado es la suma de los deltas en USD.

### Inyector de escenarios adversos ("chaos mode")

Un panel claramente etiquetado (banner rojo permanente + sección propia en
Ajustes) donde el juez **dispara en vivo**, con sliders:

- **Prob. de rechazo de pata** — cada pata puede rechazarse (fill 0).
- **Recorte de liquidez** — encoge la profundidad del book (crunch).
- **Gap de precio (en ejecución)** — el mercado se mueve en contra a mitad de
  ejecución (compra más arriba, venta más abajo).

Y **observa** al bot: fill parcial → residual → decisión re-hedge/unwind → vuelta
a plano, con **Filo narrando cada paso** (*"rechazó la pata de OKX → residual
−0.78 BTC → completé la pata faltante y volví a plano · costo −$220"*). Bajo un
gap fuerte los trades salen en **rojo** — y así debe ser: el mercado se movió en
contra y el sistema lo refleja con honestidad en vez de esconderlo.

### Dónde verlo

- **Blotter:** cada fila muestra chips de estado por pata (B✓ / S✕ / ◑) y un
  badge `RE-HEDGED` / `UNWOUND` / `PARTIAL` con el residual y el costo de
  aplanar; el P&L neto se pinta en rojo cuando es negativo.
- **Ajustes → "Escenarios adversos (simulado)":** los tres sliders + "Limpiar
  escenario".
- **Banner rojo** arriba cuando cualquier knob está activo — igual de honesto
  que el banner del modo demo.

### Cómo funciona por dentro

- `SimulatedTrade` (`packages/shared/src/index.ts`) ahora carga `buyLeg`/`sellLeg`
  (con estado), `residualBtc` (con signo), `resolution` (`none`/`rehedged`/
  `unwound`), `resolutionPnlUsd`, `finalState` y los `walletDeltas` exactos.
- Toda la lógica vive en `apps/server/src/engine/executionSimulator.ts` (patas,
  rejects, haircut de liquidez, gap, resolución del residual) y en
  `portfolio.ts` (aplica los deltas por wallet).
- El estado del escenario es parte de `EngineConfig.scenario` y viaja por el
  mismo `updateConfig` (validado y acotado en el servidor), así que también es
  **estado de servidor**: se propaga a todas las pestañas al instante.
- Igual que el resto: **fuera del hot path** y **clean-room** (arranca inactivo,
  no requiere secrets).

### Prueba de 30 segundos (para el jurado)

1. Activa **Demo** (para que fluyan ejecuciones) y abre **Ajustes →
   Escenarios adversos**.
2. Sube **Prob. de rechazo de pata** a ~50%: verás en el blotter patas en `✕`,
   residuales, y badges `RE-HEDGED`; Filo narra cada vuelta a plano.
3. Sube el **gap de precio**: los netos empiezan a salir en rojo (el mercado se
   movió en contra durante la ejecución).
4. **Limpiar escenario** → todo vuelve a ejecución normal.

---

## ✅ Enviado — Gestión de wallets tipo (s,S) + panel de inventario

El comité preguntó, textual: *"¿El sistema mantiene un balance operativo entre
exchanges de forma inteligente y automatizada?"*. El rebalanceo pasó de un umbral
único escondido a una **política de inventario (s,S) visible y configurable**, tal
como la describí en la ronda 2.

### La política (s,S) con banda muerta

Cada venue tiene un **objetivo** de BTC (el nivel *order-up-to* = su baseline
inicial) y una **banda muerta** `[objetivo − banda, objetivo + banda]`, donde
`banda = rebalanceThresholdBtc` (ajustable en vivo desde Ajustes → Rebalanceo).

- Mientras el BTC se mantenga **dentro de la banda**, no se hace nada.
- Al cruzar el **techo**, el venue envía el excedente de vuelta al **objetivo**
  (no al límite). Esa distancia entre el disparador (s) y el nivel de retorno (S)
  es justo lo que **evita el thrashing** — un wiggle chico no vuelve a disparar.
- El excedente va al venue **más agotado** (que está por debajo de su piso), así
  que una sola transferencia arregla los dos lados. La pata USD se liquida
  internamente y solo se cobra el **withdrawal fee** on-chain — amortizado entre
  trades, como en producción.

### Panel de inventario (nuevo)

Un panel dedicado (barra derecha) hace **visible** todo lo anterior:

- **Barra objetivo vs. actual por venue:** el BTC actual (verde dentro de la
  banda, rojo fuera) contra el tick del objetivo y la banda muerta pintada, con
  etiqueta *in band / above ceiling / below floor*.
- **Capacidad restante:** cuántos trades más (al tamaño máximo actual) aguanta
  cada venue antes de quedarse sin el balance que limita (USD para comprar o BTC
  para vender).
- **Timeline de rebalanceos:** las transferencias recientes (hora, ruta
  origen→destino, monto en BTC y costo), más KPIs de transferencias totales,
  costo amortizado por trade y la banda activa.

### Dónde verlo / cómo funciona

- Panel **"Inventory & rebalancing — (s,S)"** en el dashboard.
- `PortfolioStats` ahora incluye `inventory[]` (objetivo/piso/techo/capacidad por
  venue) y `rebalancing.recentEvents[]` + `bandBtc`.
- Lógica en `apps/server/src/engine/portfolio.ts` (`rebalanceIfNeeded` como (s,S),
  `inventory()` para la vista). La banda viaja por el mismo `updateConfig`
  validado en el servidor, así que es **estado de servidor**, live-tunable.

---

## ✅ Enviado — Reporte de sesión exportable (CSV/JSON)

Para que un juez se lleve **evidencia** de la sesión —no solo una captura— se
puede exportar todo lo que está en pantalla en dos formatos, desde
**Ajustes → Exportar reporte de sesión**:

- **JSON completo** — un único artefacto autocontenido con: `meta` (símbolo,
  *live since*, uptime), la **configuración exacta en uso** (modo, EV, fees por
  venue, size, guardas, banda de rebalanceo, exchanges activos, escenario), el
  **portafolio e inventario** (P&L realizado, wallets, política (s,S),
  rebalanceos), el **análisis de spreads** (mediana/p95, histograma, actividad
  por venue) y el **blotter de trades** con estados por pata y resolución del
  residual.
- **CSV de trades** — el blotter aplanado a una fila por trade
  (`executedAt`, venues, tamaños pedido/casado, precios, fees, neto, estado de
  cada pata, `residualBtc`, `resolution`, `resolutionPnlUsd`, tags de escenario)
  — listo para abrir en Excel/Sheets y auditar a mano.

### Cómo funciona por dentro

- Se arma **enteramente en el navegador** desde el estado en vivo
  (`apps/web/src/lib/report.ts`): sin round-trip al servidor, sin backend nuevo,
  sin secrets — fiel al principio **clean-room**.
- Toma la misma fuente de verdad que pinta el dashboard (`config`, `portfolio`,
  `stats`, `trades`), así que **el reporte y la pantalla nunca discrepan**.
- Descarga vía `Blob` + enlace temporal; nombres con timestamp
  (`filobot-report-<ISO>.json`, `filobot-trades-<ISO>.csv`).

---

## ✅ Enviado — Bitácora de decisiones + tests en CI

Para que el criterio detrás del código quede explícito y verificable, cerramos la
fase con dos piezas:

- **[`docs/DECISIONS.md`](DECISIONS.md)** — bitácora de decisiones técnicas en
  formato ADR corto (*contexto → decisión → alternativa descartada →
  consecuencia*): por qué EV sobre umbral, el modelo de inventario, el fee de
  retiro amortizado y la política (s,S), la ejecución en dos patas + vuelta a
  plano, la ejecución simulada / clean-room, IA fuera del hot path, el contrato de
  tipos compartido y Node vs Bun.
- **Suite de tests unitarios** sobre la lógica pura (sin red), en
  `apps/server/tests/`:
  - `profit.test.ts` — el *depth-walk* neto-de-todo (fills, corte por fee, parada
    al cruzar un nivel no rentable, tope por nominal).
  - `executionSimulator.test.ts` — máquina de dos patas (ejecución normal a plano,
    pata rechazada → residual → vuelta a plano con BTC conservado, doble rechazo →
    sin trade, haircut de liquidez).
  - `portfolio.test.ts` — (s,S) (sin transferencia dentro de la banda, envío al
    objetivo al cruzar el techo, PnL/win-rate, capacidad acotada por USD/BTC).

Corren con `bun run test` (20 tests) y `bun run typecheck` (los 3 paquetes), y
ambos se ejecutan en **CI** (`.github/workflows/ci.yml`) en cada push/PR. Los
tests viven **fuera de `src/`** para no contaminar el `tsc` de producción con
`bun:test`.

---

## ✅ Enviado — Pronóstico de deriva de inventario (capa avanzada)

Cerrando con una capa de las que mencioné en la ronda 2 (forecasting para
rebalanceo): el panel de inventario ahora **anticipa** el próximo rebalanceo en
vez de solo reaccionar.

- El portafolio mantiene una **EWMA de la deriva de BTC por trade** en cada venue
  (`portfolio.ts` → `updateDrift`), aprendida **solo del flujo de trades** (patas
  + resolución del residual), **antes** de las transferencias correctivas — así la
  velocidad de deriva refleja el trading natural, no las correcciones.
- Con esa velocidad, `projectBreach` extrapola de forma lineal **cuántos trades
  faltan** para cruzar el borde más cercano de la banda muerta (techo si acumula,
  piso si se vacía). Cada fila del panel muestra `↑ ≈ N trades al techo` /
  `↓ ≈ N trades al piso`, o **estable** si la deriva es despreciable, la muestra
  es muy chica o el horizonte es lejano.
- Es **honesto por diseño**: una heurística transparente etiquetada como
  pronóstico, no una promesa; **no** actúa por su cuenta (no fuerza transferencias
  proactivas), solo informa. Cubierta por tests (`portfolio.test.ts`: proyección
  tras warm-up y `null` antes).

**Nota de i18n.** Todo el panel de inventario (KPIs, estados *in band / above
ceiling / below floor*, timeline y el nuevo pronóstico) quedó **internacionalizado
ES/EN**, cerrando el último texto que estaba hardcodeado en inglés.

---

## ✅ Enviado — Guarda de feed dislocado + resiliencia de UI

Durante la evaluación notamos que el deploy a veces "enloquecía": un aluvión de
oportunidades como si fuera modo demo, sin serlo. Diagnóstico: en un host con
throttling, el event loop se congela y luego procesa un **backlog** de mensajes de
WS; cada uno queda con hora de recepción **fresca** aunque su precio sea viejo, así
que el guard de antigüedad no lo detecta. Ese venue queda **dislocado** y fabrica
arbitrajes fantasma.

- **Guarda por consenso multi-venue.** En cada tick el motor calcula la **mediana
  de los mids** de los venues frescos (quórum ≥3) y **descarta cualquier ruta cuyo
  venue se desvíe más de `maxVenueDeviationPct`** (1% por defecto) del consenso.
  Es **independiente del reloj**, así que sobrevive a los stalls del event loop; el
  venue `demo` (dislocado a propósito) queda exento. Implementación:
  `arbitrageEngine.computeConsensusMid` + `engine/riskManager.ts`; el rechazo
  aparece en el feed como `dislocated feed: <venue> X% vs consensus`.
- **Ahora es VISIBLE (no solo un rechazo en logs).** La misma matemática se expone
  al dashboard: `ArbitrageEngine.feedHealth()` reusa el consenso y calcula, por
  venue, la **desviación en bps**, si está **stale** y si está **dislocado**; el
  servidor la fusiona con el estado de conexión (`currentFeeds()`) y la reemite
  cada 1.5 s. En la UI:
  - Los **dots de feeds** de la barra de estado cambian de color por salud: verde
    (en consenso) · ámbar (conectando/stale) · rojo (caído) · **rojo pulsante y
    tachado (en cuarentena)**, con tooltip que muestra la desviación en bps.
  - El **panel de mercado** marca la fila del venue aislado con un badge
    **`CUARENTENA`** y la atenúa.
  - **Filo narra las transiciones** ("Puse a OKX en cuarentena: 2.1% fuera del
    consenso" / "OKX volvió al consenso"), vía `noteFeedHealth`.
  Así, el episodio embarazoso del deploy se convierte en una **demostración de
  robustez** que el juez puede ver, no solo leer.
- **Live-tunable.** `maxVenueDeviationPct` se ajusta desde Parámetros → Riesgo y
  guardas (0 = off), viaja validado por el servidor, y se suma a los presets. El
  contador de controles en vivo es **31** con 8 venues (15 base + 2 por venue).
- **Resiliencia de UI.** El frontend va envuelto en un **error boundary**: un
  payload con forma inesperada (p. ej. desfase de versión servidor/cliente en un
  redeploy parcial) muestra un mensaje recuperable con recarga en vez de una
  **pantalla en negro**. El blotter degrada con gracia trades sin estado por pata.
- Cubierto por `riskManager.test.ts` (5 casos), que ejercita la misma
  `computeConsensusMid` en que se basa `feedHealth()`. Suite total: **20 tests**.

### Fuera de alcance (deliberado)

Del backlog P2, dos ítems se descartaron **a propósito**, fieles a los principios:

- **Maker/taker + fee tiers.** La ejecución del arb es *taker* (cruzamos el
  spread); un control de *maker fee* sería un knob **sin efecto** — y un control
  que no hace nada rompe la regla de honestidad. El *taker fee* ya es editable por
  venue.
- **Más venues.** Sumar connectors WS nuevos es dependiente de red y arriesga el
  **deploy estable** que lleva semanas corriendo. No vale el riesgo en la recta
  final.

---

## Principios que no cambian

- **Honestidad primero.** Todo lo sintético (modo demo, y el futuro inyector de
  escenarios) va **claramente etiquetado**. Nunca hacemos que parezca dinero real
  "impreso".
- **Clean-room.** El repo sigue corriendo sin credenciales ni API keys. Ningún
  control nuevo requiere secrets.
- **IA y transportes fuera del hot path.** La detección y la ejecución nunca se
  bloquean por un feature nuevo.
