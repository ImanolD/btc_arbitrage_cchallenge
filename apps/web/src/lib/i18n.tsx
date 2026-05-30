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
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["es"];

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
