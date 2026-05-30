import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "es" | "en";

const STORAGE_KEY = "arb_lang";

/**
 * Explanatory-layer strings only (guide, tour, helper copy). Numeric trading
 * labels (bid/ask, EV, P(surv), p50/p95) stay in English by convention.
 */
const STRINGS = {
  es: {
    "guide.title": "Terminal de Arbitraje BTC",
    "guide.subtitle":
      "Detección de arbitraje de Bitcoin entre exchanges en tiempo real y ejecución simulada. Así se lee el panel en 60 segundos.",
    "guide.start": "Iniciar recorrido guiado",
    "guide.explore": "Explorar por mi cuenta",
    "guide.demoTitle": "¿Quieres ver el camino de ejecución completo?",
    "guide.demoBody":
      "Los arbitrajes reales son raros, así que el blotter en vivo suele estar tranquilo. El modo demo inyecta dislocaciones sintéticas claramente etiquetadas para ejercitar trades, fills parciales, P&L y rebalanceo.",
    "guide.enableDemo": "Activar demo",
    "guide.gotIt": "Entendido",
    "nav.guide": "Guía",
    "nav.tour": "Recorrido",
    "tour.next": "Siguiente",
    "tour.prev": "Atrás",
    "tour.done": "Finalizar",
    "tour.market.title": "Mercado en vivo — 8 exchanges",
    "tour.market.body":
      "Mejor bid/ask transmitido por WebSocket desde 8 exchanges, agrupado por moneda de cotización (USDT vs USD). Solo comparamos venues con la misma cotización: cruzar USD con USDT sería un edge fantasma por el peg de USDT.",
    "tour.opps.title": "Oportunidades — bruto vs neto vs EV",
    "tour.opps.body":
      "Se muestra cada cruce detectado. Las filas SKIP sobreviven como spread bruto pero mueren tras fees, latencia o valor esperado. Decidimos por VALOR ESPERADO: P(supervivencia) × neto − costo adverso, no por un umbral fijo.",
    "tour.tri.title": "Arbitraje triangular — 5 venues",
    "tour.tri.body":
      "Ciclos en un solo exchange USDT → BTC → ETH → USDT (y reverso), neto de tres taker fees, evaluados de forma independiente en cada venue.",
    "tour.stats.title": "P&L, inventario y rebalanceo",
    "tour.stats.body":
      "Usamos el modelo de inventario (capital pre-posicionado, sin transferencias on-chain por trade). El withdrawal fee se cobra solo al rebalancear y se amortiza entre trades — mira “Rebalance cost / trade”.",
    "tour.charts.title": "Ejecución y curva de equity",
    "tour.charts.body":
      "El blotter registra cada trade simulado (incluyendo fills parciales) y la curva muestra la evolución del equity en tiempo real.",
    "tour.latency.title": "Latencia, medida con honestidad",
    "tour.latency.body":
      "Latencia de procesamiento p50/p95/p99 — el tiempo que tarda nuestro código, independiente del desfase de reloj con el exchange.",
    "tour.demo.title": "Enciéndelo y míralo ejecutar",
    "tour.demo.body":
      "Activa el modo demo para inyectar dislocaciones sintéticas (claramente etiquetadas) y ver el camino completo: detección → decisión por EV → ejecución → P&L.",
    "tour.demo.cta": "Activar demo y terminar",
    "info.label": "Qué significa",
    "info.pnl.title": "P&L realizado",
    "info.pnl.body":
      "Ganancia acumulada de los arbitrajes completados, neta de taker fees, slippage y costos de rebalanceo amortizados. Es el resultado real de la estrategia: solo cambia cuando se ejecuta un trade.",
    "info.equity.title": "Equity · mark-to-market",
    "info.equity.body":
      "Valor total del portafolio en todos los venues (USD + BTC valuado al mid en vivo). Como el capital está pre-posicionado como inventario en BTC, esta cifra también se mueve con el precio de BTC; esa exposición es distinta del P&L de arbitraje. La línea base se fija al primer precio en vivo, por eso arranca en 0%.",
    "info.trades.title": "Trades ejecutados",
    "info.trades.body":
      "Número de fills de arbitraje simulados que el motor ha ejecutado, incluyendo fills parciales cuando la liquidez es escasa.",
    "info.opps.title": "Oportunidades",
    "info.opps.body":
      "Total de cruces de precio detectados vs. cuántos eran accionables (valor esperado positivo tras fees, latencia y slippage). La mayoría son solo brutos y mueren tras costos: esa es la realidad honesta de los mercados eficientes.",
    "info.winrate.title": "Win rate",
    "info.winrate.body":
      "Porcentaje de trades ejecutados que cerraron con ganancia neta positiva. Marca 0% hasta que haya trades (prueba el modo Demo).",
    "info.rebalance.title": "Costo de rebalanceo / trade",
    "info.rebalance.body":
      "El inventario se desbalancea al comprar en un venue y vender en otro. Cuando un venue supera su umbral de BTC, una transferencia on-chain simulada paga un withdrawal fee. Amortizamos ese fee entre todos los trades: el costo de retiro es de rebalanceo, no por operación.",
    "info.market.title": "Mercado — mejor bid/ask",
    "info.market.body":
      "Top-of-book en vivo de 8 exchanges por WebSocket, agrupado por moneda de cotización. “Best cross edge” es la mayor diferencia comprar-barato/vender-caro entre venues de la misma cotización, antes de fees.",
    "info.feed.title": "Feed de oportunidades",
    "info.feed.body":
      "Cada cruce detectado, más reciente primero: spread bruto → neto (tras fees y slippage) → valor esperado. Las filas SKIP son spreads brutos reales que no sobreviven los costos; las EXEC tienen EV positivo y reciben capital primero.",
    "info.latency.title": "Latencia",
    "info.latency.body":
      "La latencia de procesamiento (t2−t1) es el tiempo que tarda nuestro motor en evaluar un tick: lo que controlamos. La latencia de feed (t1−t0) y la frescura dependen del exchange y la red. Reportamos p50/p95/p99 con honestidad.",
    "info.triangular.title": "Arbitraje triangular",
    "info.triangular.body":
      "Ciclos en un solo exchange USDT → BTC → ETH → USDT (y reverso), netos de tres taker fees, evaluados de forma independiente por venue: sin transferencias entre exchanges.",
    "info.equitycurve.title": "Curva de equity",
    "info.equitycurve.body":
      "Equity del portafolio (mark-to-market) a lo largo del tiempo. Se construye al ejecutar trades; activa el modo Demo para verla moverse.",
    "info.blotter.title": "Blotter de trades",
    "info.blotter.body":
      "Cada fill simulado: ruta, tamaño llenado (fills parciales marcados), precios promedio de compra/venta, fees y ganancia neta. Es la bitácora de ejecución.",
  },
  en: {
    "guide.title": "BTC Arbitrage Terminal",
    "guide.subtitle":
      "Real-time cross-exchange Bitcoin arbitrage detection and simulated execution. Here's how to read the dashboard in 60 seconds.",
    "guide.start": "Start guided tour",
    "guide.explore": "Explore on my own",
    "guide.demoTitle": "Want to see the full execution path?",
    "guide.demoBody":
      "Real arbs are rare, so the live blotter is often quiet. Demo mode injects clearly-labeled synthetic dislocations to exercise trades, partial fills, P&L and rebalancing.",
    "guide.enableDemo": "Enable demo",
    "guide.gotIt": "Got it",
    "nav.guide": "Guide",
    "nav.tour": "Tour",
    "tour.next": "Next",
    "tour.prev": "Back",
    "tour.done": "Finish",
    "tour.market.title": "Live market — 8 exchanges",
    "tour.market.body":
      "Best bid/ask streamed over WebSocket from 8 venues, grouped by quote currency (USDT vs USD). We only compare venues with the same quote — crossing USD with USDT would be a phantom edge driven by the USDT peg.",
    "tour.opps.title": "Opportunities — gross vs net vs EV",
    "tour.opps.body":
      "Every detected cross is shown. SKIP rows survive as a gross spread but die after fees, latency or expected value. We decide by EXPECTED VALUE: P(survival) × net − adverse cost, not a raw threshold.",
    "tour.tri.title": "Triangular arbitrage — 5 venues",
    "tour.tri.body":
      "Single-exchange loops USDT → BTC → ETH → USDT (and reverse), net of three taker fees, evaluated independently on each venue.",
    "tour.stats.title": "P&L, inventory & rebalancing",
    "tour.stats.body":
      "We use the inventory model (capital pre-positioned, no per-trade on-chain transfers). Withdrawal fees are charged only on rebalancing and amortized across trades — see “Rebalance cost / trade”.",
    "tour.charts.title": "Execution & equity curve",
    "tour.charts.body":
      "The blotter records every simulated trade (including partial fills) and the curve shows equity evolving in real time.",
    "tour.latency.title": "Latency, measured honestly",
    "tour.latency.body":
      "Processing latency p50/p95/p99 — the time our code takes, independent of clock skew between us and the exchange.",
    "tour.demo.title": "Turn it on and watch it execute",
    "tour.demo.body":
      "Enable demo mode to inject clearly-labeled synthetic dislocations and see the full path: detection → EV decision → execution → P&L.",
    "tour.demo.cta": "Enable demo & finish",
    "info.label": "What this means",
    "info.pnl.title": "Realized P&L",
    "info.pnl.body":
      "Cumulative profit from completed arbitrage trades, net of taker fees, slippage and amortized rebalancing costs. This is the strategy's true output — it only moves when a trade executes.",
    "info.equity.title": "Equity · mark-to-market",
    "info.equity.body":
      "Total portfolio value across all venues (USD + BTC marked at the live mid). Because capital is pre-positioned as BTC inventory, this figure also moves with the BTC price — that exposure is separate from arbitrage P&L. The baseline is set at the first live price, so it starts at a 0% gain.",
    "info.trades.title": "Trades executed",
    "info.trades.body":
      "Number of simulated arbitrage fills the engine has executed, including partial fills when liquidity is thin.",
    "info.opps.title": "Opportunities",
    "info.opps.body":
      "Total price crosses detected vs. how many were actionable (positive expected value after fees, latency and slippage). Most crosses are gross-only and die after costs — that's the honest reality of efficient markets.",
    "info.winrate.title": "Win rate",
    "info.winrate.body":
      "Share of executed trades that closed with positive net profit. Reads 0% until trades execute (try Demo mode).",
    "info.rebalance.title": "Rebalance cost / trade",
    "info.rebalance.body":
      "Inventory drifts as the bot buys on one venue and sells on another. When a venue exceeds its BTC threshold, a simulated on-chain transfer pays a withdrawal fee. We amortize that fee across all trades — withdrawal cost is a rebalancing cost, not a per-trade cost.",
    "info.market.title": "Market — best bid/ask",
    "info.market.body":
      "Live top-of-book from 8 exchanges over WebSocket, grouped by quote currency. “Best cross edge” is the largest buy-low/sell-high gap among same-quote venues, before fees.",
    "info.feed.title": "Opportunity feed",
    "info.feed.body":
      "Every detected cross, newest first: gross spread → net (after fees & slippage) → expected value. SKIP rows are real gross spreads that don't survive costs; EXEC rows have positive EV and get capital first.",
    "info.latency.title": "Latency",
    "info.latency.body":
      "Processing latency (t2−t1) is the time our engine takes to evaluate a tick — what we control. Feed latency (t1−t0) and freshness depend on the exchange and network. We report p50/p95/p99 honestly.",
    "info.triangular.title": "Triangular arbitrage",
    "info.triangular.body":
      "Single-exchange loops USDT → BTC → ETH → USDT (and reverse), net of three taker fees, evaluated independently per venue — no inter-exchange transfer needed.",
    "info.equitycurve.title": "Equity curve",
    "info.equitycurve.body":
      "Portfolio equity (mark-to-market) over time. It builds as trades execute; enable Demo mode to see it move.",
    "info.blotter.title": "Trade blotter",
    "info.blotter.body":
      "Each simulated fill: route, filled size (partial fills flagged), average buy/sell prices, fees and net profit. This is the execution audit trail.",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["es"];

/** Translate a key into a specific language (e.g. to show ES and EN together). */
export function tn(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key] ?? key;
}

export const OTHER_LANG: Record<Lang, Lang> = { es: "en", en: "es" };

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "en" ? "en" : "es";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      setLang: setLangState,
      t: (key) => STRINGS[lang][key] ?? key,
    }),
    [lang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}
