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

## 🚧 En curso durante esta fase

Cerrar el loop no termina en la parametrización. El resto de la fase construye,
en el mismo espíritu de "hacerlo tocable, no narrarlo":

- **Robustez demostrable** — máquina de estados por pata
  (`NEW → PARTIAL → FILLED/REJECTED`), manejo de residual (Δ) y **vuelta a plano**
  (re-hedge vs unwind), y un **inyector de escenarios** claramente etiquetado
  para que el juez *dispare* un reject, un crunch de liquidez o un gap de precio y
  vea al bot manejarlo, con Filo narrando cada paso.
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
