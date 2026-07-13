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

---

## Verificación (tests + CI)

Las decisiones de arriba están respaldadas por una suite de tests unitarios sobre
la **lógica pura** (sin red), en `apps/server/tests/`:

- `profit.test.ts` — el *depth-walk* neto-de-todo: fills, corte por fee, parada al
  cruzar un nivel no rentable, tope por nominal.
- `executionSimulator.test.ts` — máquina de dos patas: ejecución normal a plano,
  pata rechazada → residual → vuelta a plano (BTC conservado), doble rechazo → sin
  trade, haircut de liquidez.
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
