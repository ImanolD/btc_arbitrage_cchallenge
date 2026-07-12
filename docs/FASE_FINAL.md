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
reiniciar**. El panel de **Ajustes** pasó de ~6 controles sueltos a un centro de
parametrización **agrupado por sección**, encabezado por un contador de
`N controles en vivo` (27 con la configuración por defecto de 8 venues; crece con
cada venue añadido).

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

1. Abre **Ajustes** (engranaje en la barra de estado). Fíjate en el contador
   `N controles en vivo` arriba.
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

## 🚧 En curso durante esta fase

Cerrar el loop continúa, en el mismo espíritu de "hacerlo tocable, no narrarlo":

- **Gestión de wallets tipo (s,S)** — rebalanceo con banda muerta y targets por
  venue, más un **panel de inventario** (objetivo vs. actual, capacidad restante,
  timeline de rebalanceos).
- **Reporte de sesión exportable** — config usada, trades, P&L, rebalanceos y
  distribución de spreads en CSV/JSON.
- **`docs/DECISIONS.md`** — bitácora de decisiones técnicas (por qué EV sobre
  umbral, modelo de inventario, fee amortizado, Node vs Bun, IA fuera del hot
  path) + suite de tests en CI.

---

## Principios que no cambian

- **Honestidad primero.** Todo lo sintético (modo demo, y el futuro inyector de
  escenarios) va **claramente etiquetado**. Nunca hacemos que parezca dinero real
  "impreso".
- **Clean-room.** El repo sigue corriendo sin credenciales ni API keys. Ningún
  control nuevo requiere secrets.
- **IA y transportes fuera del hot path.** La detección y la ejecución nunca se
  bloquean por un feature nuevo.
