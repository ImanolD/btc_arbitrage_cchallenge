# Bitácora de decisiones técnicas (ADRs)

> Un registro corto y honesto de **por qué** Filobot está construido como está.
> Cada entrada es una decisión con su contexto, la alternativa que descartamos y
> las consecuencias que asumimos. La idea no es documentar el código (para eso
> está el código y el [`README.md`](../README.md)), sino dejar rastro del
> **criterio** — que es lo que diferencia a una mesa de un bot de demo.

Formato: **Contexto → Decisión → Alternativa descartada → Consecuencia.**

---

## 1. Decidir por Valor Esperado (EV), no por umbral de spread

- **Contexto.** Un cruce con spread neto positivo puede ser una trampa: si es
  frágil (poca profundidad, latencia alta, mercado moviéndose), para cuando
  llegás ya se dio vuelta y ejecutás en contra.
- **Decisión.** La compuerta de ejecución es
  `EV = P(supervivencia) × neto − (1 − P) × costo_adverso`, y disparamos con
  `EV > mínimo`, no con "neto > 0". `P(supervivencia)` es una heurística
  transparente sobre latencia y tamaño (ver `engine/expectedValue.ts`).
- **Alternativa descartada.** Umbral de spread simple. Lo dejamos como **modo
  seleccionable** (`decisionMode: "spread"`) justamente para poder *demostrar*
  en vivo cuántos cruces frágiles acepta de más.
- **Consecuencia.** Menos trades, pero de mejor calidad esperada. El costo es
  que EV depende de una estimación de `P` — por eso `τ`, `adverseBps` y `EV
  mínimo` son **parametrizables en vivo** y el número se muestra en ambos modos.

## 2. Modelo de inventario (capital pre-posicionado), no transferencia por trade

- **Contexto.** El arbitraje cross-exchange "de manual" asume comprar en A y
  transferir a B en cada operación. On-chain eso es lento (confirmaciones) y
  caro (fee de red) — inviable a la frecuencia del arbitraje real.
- **Decisión.** Pre-posicionamos capital en **ambos** lados (USD y BTC en cada
  venue). Comprar en A debita USD/acredita BTC en A; vender en B debita BTC/
  acredita USD en B. Las transferencias on-chain son la **excepción** (rebalanceo),
  no la regla.
- **Alternativa descartada.** Transferir en cada trade. Habría hecho el modelo de
  latencia y de fees una ficción.
- **Consecuencia.** Los balances **driftan** con el tiempo (A junta BTC, B junta
  USD). No lo escondemos: lo mostramos en el panel de inventario y lo corregimos
  con una política explícita (ver #3).

## 3. Rebalanceo como política (s,S) con banda muerta, tratado como centro de costos

- **Contexto.** Si rebalanceás ante cualquier drift, hacés *thrashing*:
  transferís de más y el fee de red te come el edge.
- **Decisión.** Política **(s,S)**: cada venue tiene un objetivo (order-up-to) y
  una **banda muerta** `[objetivo − banda, objetivo + banda]`. No se hace nada
  dentro de la banda; al cruzar el techo se envía el excedente **de vuelta al
  objetivo** (no al límite). El excedente va al venue más agotado, así una
  transferencia arregla los dos lados. Solo se cobra el **withdrawal fee**
  on-chain, **amortizado** entre trades.
- **Alternativa descartada.** Umbral único (disparar y volver al mismo punto):
  vuelve a dispararse con cualquier wiggle. La distancia s→S es justo lo que lo
  evita.
- **Consecuencia.** El rebalanceo es un **costo**, no una fuente de PnL, y así lo
  contabilizamos (resta del PnL realizado, se reporta el costo amortizado por
  trade). `band` es parametrizable en vivo. Sobre esto agregamos un **pronóstico
  de deriva** (EWMA de BTC/trade por venue) que proyecta "≈ N trades hasta el
  borde de la banda" — pero es **solo informativo**: decidimos que **no** dispare
  transferencias proactivas, porque una heurística que actúa sola puede gastar
  fees de más; que el humano (o una versión futura auditada) decida.

## 4. Ejecución en dos patas + vuelta a plano

- **Contexto.** En la práctica una pata puede rechazarse o llenarse parcial. Si
  no lo modelás, tu simulador miente sobre el peor caso.
- **Decisión.** Cada ejecución son **dos órdenes independientes** (compra/venta),
  cada una con estado `filled`/`partial`/`rejected`. Si quedan descalzadas hay un
  **residual direccional** y el motor **vuelve a plano** eligiendo lo más barato:
  *re-hedge* (completar la pata faltante) o *unwind* (deshacer la que llenó).
- **Alternativa descartada.** Asumir fills atómicos "todo o nada". Cómodo, pero
  irreal — y el comité preguntó explícitamente por el comportamiento ante fallos.
- **Consecuencia.** La contabilidad se hace por **deltas por wallet** (el BTC se
  conserva a plano; el PnL realizado es la suma de deltas USD). Un inyector de
  escenarios claramente etiquetado permite forzar rechazos, crunch de liquidez y
  gaps de precio para *ver* el manejo en vivo.

## 5. Ejecución **simulada** y repo **clean-room**

- **Contexto.** Es un challenge/portfolio, no una cuenta con fondos reales.
  Queremos que cualquiera lo corra sin credenciales ni riesgo.
- **Decisión.** Datos de mercado **reales** (WebSockets de 8 exchanges), pero
  **ejecución simulada**. El repo arranca **sin API keys ni secrets**. Todo lo
  sintético (modo demo, inyector de escenarios) va **claramente etiquetado**.
- **Alternativa descartada.** Ejecución real: fuera de alcance, riesgosa e
  imposible de reproducir para un juez.
- **Consecuencia.** Honestidad por diseño: nunca hacemos que parezca "dinero real
  impreso". La lógica de decisión/ejecución es idéntica a la que iría a producción.

## 6. IA y transportes **fuera del hot path**

- **Contexto.** La detección y la ejecución son sensibles a la latencia; un
  feature nuevo no puede bloquearlas.
- **Decisión.** Filo (el copiloto) **narra e interpreta**, nunca decide trades.
  Corre en dos capas: matcher determinista (instantáneo, siempre disponible,
  *grounded*) y una capa **opcional** con Claude que solo lee el estado en JSON.
  Persistencia (Mongo) y WhatsApp (Kapso) son igual de opcionales.
- **Alternativa descartada.** Que un LLM esté en el camino de la decisión. Lento,
  no determinista y no *grounded* — inaceptable para ejecutar.
- **Consecuencia.** Sin `ANTHROPIC_API_KEY` (o si hay timeout/falla) Filo cae a la
  respuesta determinista. La demo **nunca** depende de una llamada remota.

## 7. Contrato de tipos compartido + estado en el servidor

- **Contexto.** Server y web deben coincidir exactamente en la forma de los datos,
  y toda parametrización debe verse igual en todas las pestañas.
- **Decisión.** Monorepo con `packages/shared` como **única fuente de verdad** de
  tipos (`EngineConfig`, `SimulatedTrade`, `PortfolioStats`, …). La config es
  **estado de servidor**: cada patch se **valida y acota** en el server y se
  reemite por Socket.IO a todos los clientes. Ningún valor del cliente entra crudo
  al motor.
- **Alternativa descartada.** Tipos duplicados por app / estado de config local en
  el cliente. Fuente garantizada de *drift* y bugs sutiles.
- **Consecuencia.** Cambiar un tipo rompe el `typecheck` de ambos lados a la vez
  (deseable). La config que ve el dashboard es, por construcción, la que usa el
  motor.

## 8. Runtime: Bun para DX, Node para producción

- **Contexto.** Queremos TS sin fricción en desarrollo, pero un despliegue
  estándar y portable.
- **Decisión.** **Bun** para el workspace, los scripts (`--filter`) y los **tests**
  (runner nativo, TS sin config). El servidor se **compila con `tsc`** y corre en
  **Node ≥ 20** en producción (`node dist/index.js`); `tsx` para el modo dev.
- **Alternativa descartada.** Bun-only en producción. Excelente DX, pero menos
  garantías de paridad con el runtime más común de los PaaS.
- **Consecuencia.** El `typecheck` (tsc, por paquete) es la fuente de verdad de
  tipos; los tests corren con `bun test`. Los archivos de test viven **fuera de
  `src/`** para no contaminar el `tsc` de producción con `bun:test`.

## 9. Guarda de feed dislocado por consenso (no por confianza en cada feed)

- **Contexto.** En un host con throttling (p. ej. free tier), el event loop se
  congela y luego procesa un **backlog** de mensajes de WS. Cada uno se sella con
  una hora de recepción **fresca** aunque su precio sea viejo, así que el guard de
  antigüedad (basado en `receivedAt`) no lo detecta. Ese venue queda **dislocado**
  del mercado y fabrica "arbitrajes" fantasma — el sistema parece "imprimir"
  dinero (lo vimos en el deploy durante la evaluación).
- **Decisión.** No confiar en cada feed aislado: calcular en cada tick la
  **mediana de los mids** de los venues frescos (quórum ≥3) y **descartar toda
  ruta cuyo venue se desvíe más de `maxVenueDeviationPct`** (1% por defecto) del
  consenso. El arbitraje real es de puntos básicos; una desviación >1% es
  esencialmente siempre un feed malo, no una oportunidad.
- **Alternativa descartada.** Endurecer el guard de spread por par
  (`maxSaneSpreadPct`). Es un instrumento romo: no distingue un par legítimamente
  ancho de un venue dislocado, y no captura la dislocación **simétrica** vs el
  resto. El consenso es **independiente del reloj**, así que sobrevive a los stalls
  del event loop. El venue `demo` (dislocado a propósito) queda exento.
- **Consecuencia.** El sistema se mantiene honesto bajo condiciones adversas de
  red en vez de disparar trades fantasma. El umbral es live-tunable (se suma al
  criterio de parametrización). Cubierto por `riskManager.test.ts`.

## 10. Error boundary de UI (nunca una pantalla en negro)

- **Contexto.** Sin red de seguridad, un error de render (p. ej. un desfase de
  versión servidor/cliente durante un redeploy parcial) desmonta todo el árbol y
  deja una pantalla en negro — el peor primer impacto posible para un juez.
- **Decisión.** Envolver la app en un **error boundary** con mensaje recuperable +
  recarga, y hacer que los componentes nuevos degraden con gracia ante payloads de
  una forma inesperada (el blotter tolera trades sin estado por pata).
- **Alternativa descartada.** Confiar en que servidor y cliente siempre estén en la
  misma versión. Los deploys de web (Vercel) y servidor (Railway) son
  independientes y no atómicos.
- **Consecuencia.** Una ventana de deploy inconsistente degrada con gracia en vez
  de romper por completo.

## 11. Controles de riesgo automáticos: disyuntor por venue + kill-switch de sesión

- **Contexto.** La guarda por trade (#1, #4, #9) decide *este* cruce, pero una
  mesa real también necesita controles que **detengan o aíslen** la operación
  cuando algo se rompe sistemáticamente — no seguir golpeando un venue que
  rechaza todo, ni operar mientras la sesión sangra.
- **Decisión.** Un `RiskGovernor` con dos controles independientes: (a) un
  **disyuntor por venue** que cuenta rechazos de pata en una ventana móvil y, al
  cruzar el umbral, **banquea** ese venue durante un cooldown antes de rearmarse
  solo; (b) un **kill-switch de sesión** que, si el PnL realizado cae a
  −`maxSessionLossUsd`, **detiene TODA ejecución** (la detección sigue) hasta el
  reset. Ambos son live-tunables, se **ven** en el panel (badge por venue,
  banner de HALT) y Filo narra las transiciones.
- **Alternativa descartada.** Solo la guarda por trade. Reacciona cruce a cruce
  pero nunca "se rinde" ante un patrón de fallos ni pone un piso a la pérdida —
  justo lo que el comité subrayó en robustez.
- **Consecuencia.** El disyuntor se dispara con el escenario de rechazo, así que
  el juez lo puede **provocar y ver actuar**. Cubierto por `riskGovernor.test.ts`.

## 12. "Tirar un exchange" como evento adverso (no como toggle de config)

- **Contexto.** Apagar un venue desde "Exchanges activos" (#7) es una decisión de
  *configuración*. Simular que un exchange **se cae** en medio de la operación es
  un evento *adverso* distinto, y es lo que pidieron poder disparar.
- **Decisión.** El inyector de escenarios gana `downedVenues`: al tirar un venue,
  el motor **congela su feed** (deja de ingerir sus books). Su cotización
  envejece, la guarda de quote obsoleta (#9) lo saca sola, cae del consenso y el
  bot **enruta alrededor** — el sistema *detecta y maneja* la caída, no la
  esconde. Se ve como "CAÍDO (forzado)" y Filo lo narra.
- **Alternativa descartada.** Reusar el toggle de venue activo. Habría mezclado
  "lo excluyo por decisión" con "se cayó y reaccioné", que es el punto a mostrar.
- **Consecuencia.** Reutiliza las guardas existentes en vez de inventar un camino
  nuevo: la caída se maneja con el mismo mecanismo honesto que ya defiende al bot.

## 13. Modo de fee maker/taker: una perilla que mueve la lógica, no decorativa

- **Contexto.** El comité advierte contra "parametrización de cartón". Exponer un
  fee maker que no cambia nada sería exactamente eso.
- **Decisión.** `feeMode` real: en `maker`, la pata **pasiva** (compra) asume
  descansar como orden maker y paga el fee maker (menor/rebate); la pata activa
  (venta) sigue cruzando como taker. El fee menor **cambia qué cruces superan el
  umbral neto** y se ve en el feed (EXEC/SKIP) y en el PnL. Es honesto **solo**
  con un escenario de rechazo activo, porque los fills maker no están
  garantizados — y lo documentamos así.
- **Alternativa descartada.** (a) Agregar un campo maker "informativo" que no
  entra al cálculo (cartón). (b) Modelar maker sin riesgo de fill (deshonesto).
- **Consecuencia.** La perilla altera de verdad una decisión; el arb sigue siendo
  taker-taker por defecto (correcto para latencia). Cubierto por
  `executionSimulator.test.ts` (maker ⇒ menos fees, más neto).

## 14. Replay de mercado real (grabación) vs. solo demo sintético

- **Contexto.** El modo demo inyecta dislocaciones **sintéticas**: perfecto para
  ejercitar el camino de ejecución, pero no es mercado real. Frente al jurado,
  cuando el mercado en vivo está tranquilo, conviene una demo **reproducible**
  hecha de datos reales.
- **Decisión.** Un `MarketRecorder` (ring buffer acotado) graba los ticks reales;
  un `ReplayPlayer` los reproduce por el motor a **velocidad variable**,
  reescribiendo los timestamps a "ahora" para que la guarda de quote obsoleta no
  los rechace. Mientras el replay está activo, los feeds en vivo se **congelan**
  (el tape maneja el motor), es **mutuamente excluyente** con demo y va con banner.
- **Alternativa descartada.** Solo demo sintético. No permite reproducir una
  ventana de mercado real ni controlar la velocidad para explicar un episodio.
- **Consecuencia.** Demo reproducible cuando el mercado no coopera, sin mentir
  sobre el origen del dato. Memoria acotada (buffer con tope), auto-stop al
  quedarse sin clientes, igual que el demo.

---

## Verificación (tests + CI)

Las decisiones de arriba están respaldadas por una suite de tests unitarios sobre
la **lógica pura** (sin red), en `apps/server/tests/`:

- `profit.test.ts` — el *depth-walk* neto-de-todo: fills, corte por fee, parada al
  cruzar un nivel no rentable, tope por nominal.
- `executionSimulator.test.ts` — máquina de dos patas: ejecución normal a plano,
  pata rechazada → residual → vuelta a plano (BTC conservado), doble rechazo → sin
  trade, haircut de liquidez, y **modo maker** (fee menor en la pata pasiva ⇒
  menos fees y más neto — la perilla mueve PnL real).
- `riskGovernor.test.ts` — controles automáticos: el disyuntor por venue se
  dispara tras N rechazos en la ventana y se rearma tras el cooldown; los
  rechazos fuera de ventana no cuentan; `breakerRejects = 0` lo desactiva; el
  kill-switch de sesión detiene/reanuda según el PnL realizado y `= 0` lo apaga.
- `portfolio.test.ts` — (s,S): sin transferencia dentro de la banda, envío al
  objetivo al cruzar el techo, PnL/win-rate, capacidad acotada por USD/BTC, y el
  pronóstico de deriva (proyección tras warm-up, `null` antes).
- `riskManager.test.ts` — guarda de feed dislocado: pasa cerca del consenso,
  rechaza un venue dislocado, inactiva sin quórum, `demo` exento, y prioridad del
  guard de quote obsoleta.

```bash
bun run typecheck   # shared + server + web
bun run test        # suite del motor (apps/server/tests)
```

CI (`.github/workflows/ci.yml`) corre ambos en cada push/PR con Bun sobre Ubuntu.
