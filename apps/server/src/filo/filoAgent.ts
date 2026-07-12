import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  EngineConfig,
  ExchangeId,
  FiloLang,
  FiloMessage,
  LatencyStats,
  Opportunity,
  PortfolioStats,
  SimulatedTrade,
  StatsSnapshot,
} from "@arb/shared";
import type { ArbitrageEngine } from "../engine/arbitrageEngine.js";
import { llmAnswer, llmEnabled } from "./llm.js";

/** Min gap between narrations of the same category (ms). */
const THROTTLE = {
  exec: 6_000,
  best: 14_000,
  skip: 22_000,
  residual: 9_000,
} as const;

/** Cap on the in-memory message backlog replayed to new clients. */
const HISTORY_CAP = 40;

type Bilingual = Record<FiloLang, string>;

/**
 * Filo: the conversational voice of the bot. One brain, transport-agnostic —
 * it emits `message` events (narrations) that the server broadcasts, and
 * answers questions on demand. Answers are deterministic-first (grounded, free,
 * always available) and fall back to the optional Claude layer only for
 * free-form questions the rule-based matcher doesn't confidently handle.
 */
export class FiloAgent extends EventEmitter {
  private readonly history: FiloMessage[] = [];
  private lastEmit: Record<string, number> = {};
  private digestTimer: ReturnType<typeof setInterval> | null = null;

  // Live world state, kept current from engine events.
  private portfolio: PortfolioStats | null = null;
  private latency: LatencyStats | null = null;
  private stats: StatsSnapshot | null = null;
  private bestActionable: { opp: Opportunity; at: number } | null = null;
  private lastSkip: Opportunity | null = null;
  private readonly recentTrades: SimulatedTrade[] = [];
  private pendingTrades: SimulatedTrade[] = [];
  /** Last-announced adverse-scenario active state (for on↔off narration). */
  private scenarioActive = false;

  constructor(private readonly config: EngineConfig) {
    super();
    this.seedGreeting();
  }

  /** Subscribe to the engine's analytics + execution stream. */
  attach(engine: ArbitrageEngine): void {
    engine.on("portfolio", (p) => (this.portfolio = p));
    engine.on("latency", (l) => (this.latency = l));
    engine.on("stats", (s) => (this.stats = s));
    engine.on("opportunity", (o) => this.onOpportunity(o));
    engine.on("trade", (t) => this.onTrade(t));
  }

  start(): void {
    this.scheduleDigest();
  }

  stop(): void {
    if (this.digestTimer) clearInterval(this.digestTimer);
  }

  /** Re-read live config (digest cadence). Call after the config is mutated. */
  applyConfig(): void {
    this.scheduleDigest();
  }

  private scheduleDigest(): void {
    if (this.digestTimer) clearInterval(this.digestTimer);
    this.digestTimer = null;
    const ms = this.config.filo.digestMs;
    if (ms > 0) this.digestTimer = setInterval(() => this.emitDigest(), ms);
  }

  /** Recent messages, for replaying to a freshly-connected dashboard. */
  backlog(): FiloMessage[] {
    return [...this.history];
  }

  /** True when the optional LLM layer is configured. */
  get aiEnabled(): boolean {
    return llmEnabled();
  }

  /* ── Public surface: questions ───────────────────────────────────────── */

  /**
   * Answer a free-form question. Deterministic intent matching first (grounded,
   * instant); the LLM only handles what the matcher leaves unmatched, and any
   * LLM failure degrades gracefully back to a deterministic help message.
   */
  async ask(text: string, lang: FiloLang): Promise<FiloMessage> {
    const det = this.answerDeterministic(text);
    if (det) return this.makeAnswer(det, false);

    if (llmEnabled()) {
      const reply = await llmAnswer(text, lang, this.buildContext());
      if (reply) {
        // LLM replies in the asked language only; fill that slot and let the UI
        // fall back to it if the viewer switches languages.
        return this.makeAnswer({ [lang]: reply } as Partial<Bilingual>, true);
      }
    }
    return this.makeAnswer(this.helpText(), false);
  }

  /** Note an external state change worth narrating (demo toggle). */
  noteDemo(enabled: boolean): void {
    this.push("update", enabled ? T.demoOn : T.demoOff, enabled ? "warn" : "info");
  }

  /** Note a venue feed dropping out. */
  noteFeedDown(exchange: ExchangeId): void {
    this.push("update", T.feedDown(cap(exchange)), "warn");
  }

  /* ── Narration triggers ──────────────────────────────────────────────── */

  private onOpportunity(opp: Opportunity): void {
    if (opp.actionable) {
      if (!this.bestActionable || opp.expectedValueUsd > this.bestActionable.opp.expectedValueUsd) {
        this.bestActionable = { opp, at: Date.now() };
      }
      if (this.gate("best", THROTTLE.best)) {
        this.push("update", T.best(opp), "good");
      }
    } else if (opp.grossProfit > 0 && opp.netProfit < 0) {
      this.lastSkip = opp;
      if (this.gate("skip", THROTTLE.skip)) {
        this.push("update", T.skip(opp), "warn");
      }
    }
  }

  private onTrade(trade: SimulatedTrade): void {
    this.recentTrades.unshift(trade);
    this.recentTrades.length = Math.min(this.recentTrades.length, 12);
    this.pendingTrades.push(trade);
    if (this.gate("exec", THROTTLE.exec)) {
      const batch = this.pendingTrades;
      this.pendingTrades = [];
      const pnl = batch.reduce((s, t) => s + t.netProfit, 0);
      this.push("update", T.exec(batch.length, pnl, batch[batch.length - 1]), pnl >= 0 ? "good" : "bad");
    }
    // Residual resolution (a leg rejected / partial-filled, then we returned to
    // flat) is the whole point of the scenario injector — narrate it separately.
    if (trade.resolution !== "none" && this.gate("residual", THROTTLE.residual)) {
      this.push("update", T.residual(trade), "warn");
    }
  }

  /**
   * The adverse-scenario injector state changed (server calls this from the
   * config patch). Narrate on/off so the chat makes the honesty explicit.
   */
  noteScenario(scenario: EngineConfig["scenario"]): void {
    const active =
      scenario.rejectProb > 0 ||
      scenario.liquidityHaircutPct > 0 ||
      scenario.priceGapBps > 0;
    // Always announce the on↔off transition; throttle mid-drag adjustments so a
    // slider doesn't flood the chat.
    if (active === this.scenarioActive && !this.gate("scenario", 5_000)) return;
    this.scenarioActive = active;
    this.push("update", T.scenario(scenario, active), active ? "warn" : "info");
  }

  private emitDigest(): void {
    const s = this.stats;
    const p = this.portfolio;
    if ((!s || s.sampleCount === 0) && (!p || p.totalTrades === 0)) return;
    this.push("update", T.digest(s, p, this.latency), "info");
  }

  /* ── Deterministic Q&A ───────────────────────────────────────────────── */

  /** Returns bilingual copy when an intent is confidently matched, else null. */
  private answerDeterministic(raw: string): Partial<Bilingual> | null {
    const q = raw.toLowerCase();
    const has = (...words: string[]) => words.some((w) => q.includes(w));
    const p = this.portfolio;
    const s = this.stats;

    if (has("hola", "hello", "hi ", "hey", "ayuda", "help", "qué puedes", "what can")) {
      return this.helpText();
    }
    if (has("p&l", "pnl", "profit", "ganancia", "gane", "earn", "made")) {
      if (!p) return T.noData;
      return {
        es: `P&L realizado: ${sUsd(p.realizedPnlUsd)} en ${p.totalTrades} trades (win rate ${pct(p.winRate)}). Solo cambia cuando ejecuto un arbitraje, neto de fees, slippage y rebalanceo amortizado.`,
        en: `Realized P&L: ${sUsd(p.realizedPnlUsd)} across ${p.totalTrades} trades (win rate ${pct(p.winRate)}). It only moves when I execute an arb, net of fees, slippage and amortized rebalancing.`,
      };
    }
    if (has("equity", "patrimonio", "portfolio value", "valor del port")) {
      if (!p) return T.noData;
      const ch = p.startingEquityUsd > 0 ? (p.currentEquityUsd / p.startingEquityUsd - 1) : 0;
      return {
        es: `Equity (mark-to-market): ${usd(p.currentEquityUsd)} (${sPct(ch)} desde el primer precio en vivo). Incluye USD + BTC pre-posicionado, así que también se mueve con el precio de BTC — eso es exposición de inventario, no P&L de arbitraje.`,
        en: `Equity (mark-to-market): ${usd(p.currentEquityUsd)} (${sPct(ch)} since the first live price). It includes USD + pre-positioned BTC, so it also moves with BTC's price — that's inventory exposure, not arbitrage P&L.`,
      };
    }
    if (has("opportun", "oportunidad", "cruces", "crosses", "cuántas", "cuantas", "how many")) {
      if (!p) return T.noData;
      const rate = s ? `${s.opportunities.actionableRatePct}%` : pct(p.totalOpportunities > 0 ? p.actionableOpportunities / p.totalOpportunities : 0);
      return {
        es: `Detecté ${fmt(p.totalOpportunities)} cruces; ${fmt(p.actionableOpportunities)} accionables (${rate}). Casi todos son spread bruto que muere tras fees y latencia — por eso decido por valor esperado, no por umbral.`,
        en: `I've detected ${fmt(p.totalOpportunities)} crosses; ${fmt(p.actionableOpportunities)} actionable (${rate}). Almost all are gross spreads that die after fees and latency — which is why I decide by expected value, not a threshold.`,
      };
    }
    if (has("latency", "latencia", "fast", "rápid", "rapid", "speed", "p50", "p95", "p99")) {
      if (!this.latency) return T.noData;
      const pr = this.latency.processing;
      return {
        es: `Latencia de procesamiento (lo que controlo): p50 ${ms(pr.p50)}, p95 ${ms(pr.p95)}, p99 ${ms(pr.p99)}, medida en reloj monotónico. La latencia de feed depende del exchange y la red.`,
        en: `Processing latency (what I control): p50 ${ms(pr.p50)}, p95 ${ms(pr.p95)}, p99 ${ms(pr.p99)}, measured on a monotonic clock. Feed latency depends on the exchange and network.`,
      };
    }
    if (has("best", "mejor", "top opp")) {
      const b = this.bestActionable;
      if (!b || Date.now() - b.at > 45_000) {
        return {
          es: "Ahora mismo no hay una oportunidad accionable fresca — el spread no cubre fees + EV. Prueba el modo Demo para ver el camino de ejecución completo.",
          en: "No fresh actionable opportunity right now — the spread doesn't clear fees + EV. Try Demo mode to see the full execution path.",
        };
      }
      return { es: T.best(b.opp).es, en: T.best(b.opp).en };
    }
    if (has("trade", "operaci", "fill", "win rate", "tasa de acierto")) {
      if (!p) return T.noData;
      const last = this.recentTrades[0];
      const lastEs = last ? ` Último: ${cap(last.buyExchange)}→${cap(last.sellExchange)} ${sUsd(last.netProfit)}${last.partial ? " (parcial)" : ""}.` : "";
      const lastEn = last ? ` Last: ${cap(last.buyExchange)}→${cap(last.sellExchange)} ${sUsd(last.netProfit)}${last.partial ? " (partial)" : ""}.` : "";
      return {
        es: `Ejecuté ${p.totalTrades} trades, win rate ${pct(p.winRate)}.${lastEs}`,
        en: `I've executed ${p.totalTrades} trades, win rate ${pct(p.winRate)}.${lastEn}`,
      };
    }
    if (has("rebalanc", "withdrawal", "retiro")) {
      if (!p) return T.noData;
      const r = p.rebalancing;
      return {
        es: `Rebalanceo: ${r.events} transferencias on-chain, costo total ${usd(r.totalCostUsd)}, amortizado a ${usd(r.amortizedCostPerTradeUsd)}/trade. El withdrawal fee es costo de rebalanceo, no por operación (modelo de inventario).`,
        en: `Rebalancing: ${r.events} on-chain transfers, total cost ${usd(r.totalCostUsd)}, amortized to ${usd(r.amortizedCostPerTradeUsd)}/trade. The withdrawal fee is a rebalancing cost, not per-trade (inventory model).`,
      };
    }
    if (has("survival", "supervivencia", "probabil")) {
      if (!s) return T.noData;
      return {
        es: `Supervivencia media estimada: ${pct(s.meanSurvival)}. La modelo como exp(−edad/τ) × confianza-de-edge × soporte-de-liquidez; entra en el EV junto al costo de selección adversa.`,
        en: `Mean estimated survival: ${pct(s.meanSurvival)}. I model it as exp(−age/τ) × edge-confidence × liquidity-support; it feeds EV alongside the adverse-selection cost.`,
      };
    }
    if (has("demo")) {
      return this.config.demoMode
        ? { es: "El modo demo está ACTIVO: inyecto dislocaciones sintéticas claramente etiquetadas para ejercitar el camino completo de ejecución.", en: "Demo mode is ON: I'm injecting clearly-labeled synthetic dislocations to exercise the full execution path." }
        : { es: "El modo demo está apagado (monitoreo en vivo). Actívalo con el botón “Demo” para ver trades, fills parciales y P&L moverse.", en: "Demo mode is off (live monitoring). Flip the “Demo” button to watch trades, partial fills and P&L move." };
    }
    if (has("exchange", "venue", "mercado", "where")) {
      const list = this.config.exchanges.filter((e) => e !== "demo").map(cap).join(", ");
      const topVenue = s && s.venues.length > 0 ? [...s.venues].sort((a, b) => (b.asBuy + b.asSell) - (a.asBuy + a.asSell))[0] : null;
      const tEs = topVenue ? ` Más activo en cruces: ${cap(topVenue.exchange)}.` : "";
      const tEn = topVenue ? ` Most active in crosses: ${cap(topVenue.exchange)}.` : "";
      return {
        es: `Vigilo ${list} por WebSocket, agrupados por moneda de cotización (USDT vs USD).${tEs}`,
        en: `I watch ${list} over WebSocket, grouped by quote currency (USDT vs USD).${tEn}`,
      };
    }
    if (has("why skip", "por qué", "porque", "why not", "why didn", "rejected", "descart")) {
      const sk = this.lastSkip;
      if (sk) return T.skip(sk);
      return {
        es: "Rechazo un cruce cuando el spread bruto no sobrevive a fees + slippage + latencia, o cuando el valor esperado (P(superv) × neto − costo adverso) no es positivo.",
        en: "I reject a cross when the gross spread doesn't survive fees + slippage + latency, or when expected value (P(surv) × net − adverse cost) isn't positive.",
      };
    }
    return null;
  }

  private helpText(): Bilingual {
    const ai = llmEnabled()
      ? { es: " También puedo responder preguntas libres.", en: " I can also field free-form questions." }
      : { es: "", en: "" };
    return {
      es: `¡Miau! Soy Filo. Pregúntame por el P&L, oportunidades, latencia, mejor trade, rebalanceo, supervivencia o el modo demo.${ai.es}`,
      en: `Meow! I'm Filo. Ask me about P&L, opportunities, latency, best trade, rebalancing, survival, or demo mode.${ai.en}`,
    };
  }

  /* ── Grounded context for the LLM ────────────────────────────────────── */

  private buildContext() {
    const p = this.portfolio;
    const s = this.stats;
    const b = this.bestActionable && Date.now() - this.bestActionable.at < 45_000 ? this.bestActionable.opp : null;
    return {
      symbol: this.config.symbol,
      exchanges: this.config.exchanges.filter((e) => e !== "demo"),
      demoMode: this.config.demoMode,
      ev: this.config.ev,
      portfolio: p && {
        realizedPnlUsd: round(p.realizedPnlUsd),
        currentEquityUsd: round(p.currentEquityUsd),
        startingEquityUsd: round(p.startingEquityUsd),
        equityChangePct: p.startingEquityUsd > 0 ? round((p.currentEquityUsd / p.startingEquityUsd - 1) * 100) : 0,
        totalTrades: p.totalTrades,
        totalOpportunities: p.totalOpportunities,
        actionableOpportunities: p.actionableOpportunities,
        winRatePct: round(p.winRate * 100),
        rebalanceEvents: p.rebalancing.events,
        rebalanceCostPerTradeUsd: round(p.rebalancing.amortizedCostPerTradeUsd),
      },
      processingLatencyMs: this.latency
        ? { p50: this.latency.processing.p50, p95: this.latency.processing.p95, p99: this.latency.processing.p99 }
        : null,
      analysis: s && {
        crossesSampled: s.sampleCount,
        crossesPerMinute: s.opportunities.perMinute,
        actionableRatePct: s.opportunities.actionableRatePct,
        grossSpreadMedianBps: s.grossBps.p50,
        netSpreadMedianBps: s.netBps.p50,
        meanSurvivalPct: round(s.meanSurvival * 100),
      },
      bestActionable: b && {
        buy: b.buyExchange,
        sell: b.sellExchange,
        netProfitUsd: b.netProfit,
        expectedValueUsd: b.expectedValueUsd,
        survivalPct: round(b.survivalProb * 100),
      },
      recentTrades: this.recentTrades.slice(0, 6).map((t) => ({
        buy: t.buyExchange,
        sell: t.sellExchange,
        netProfitUsd: round(t.netProfit),
        partial: t.partial,
      })),
    };
  }

  /* ── Plumbing ────────────────────────────────────────────────────────── */

  private gate(key: string, intervalMs: number): boolean {
    const now = Date.now();
    if (now - (this.lastEmit[key] ?? 0) < intervalMs) return false;
    this.lastEmit[key] = now;
    return true;
  }

  private seedGreeting(): void {
    const msg: FiloMessage = {
      id: randomUUID(),
      role: "filo",
      kind: "greeting",
      tone: "info",
      ts: Date.now(),
      text: {
        es: "¡Miau! Soy Filo 🐾 Vigilo el arbitraje de BTC entre exchanges en vivo y te aviso cuando algo relevante pasa. Pregúntame lo que quieras: P&L, oportunidades, latencia…",
        en: "Meow! I'm Filo 🐾 I watch cross-exchange BTC arbitrage live and ping you when something relevant happens. Ask me anything: P&L, opportunities, latency…",
      },
    };
    this.history.push(msg);
  }

  private makeAnswer(text: Partial<Bilingual>, ai: boolean): FiloMessage {
    const msg: FiloMessage = { id: randomUUID(), role: "filo", kind: "answer", text, ai, ts: Date.now() };
    this.record(msg);
    return msg;
  }

  private push(kind: FiloMessage["kind"], text: Partial<Bilingual>, tone: FiloMessage["tone"]): void {
    // Unprompted narrations are suppressed when narration is muted; answers and
    // the greeting don't go through here, so they're always delivered.
    if (!this.config.filo.narrate) return;
    const msg: FiloMessage = { id: randomUUID(), role: "filo", kind, text, tone, ts: Date.now() };
    this.record(msg);
    this.emit("message", msg);
  }

  private record(msg: FiloMessage): void {
    this.history.push(msg);
    if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
  }
}

export interface FiloAgent {
  on(event: "message", listener: (msg: FiloMessage) => void): this;
  emit(event: "message", msg: FiloMessage): boolean;
}

/* ── Bilingual narration templates ─────────────────────────────────────── */

const T = {
  noData: {
    es: "Todavía estoy recopilando datos — dame unos segundos de mercado en vivo.",
    en: "I'm still gathering data — give me a few seconds of live market.",
  } as Bilingual,
  demoOn: {
    es: "Modo demo ACTIVADO 🧪 Inyecto dislocaciones sintéticas (claramente etiquetadas) para ejercitar el camino completo: detección → decisión por EV → ejecución → P&L.",
    en: "Demo mode ON 🧪 I'm injecting clearly-labeled synthetic dislocations to exercise the full path: detection → EV decision → execution → P&L.",
  } as Bilingual,
  demoOff: {
    es: "Modo demo desactivado. Vuelvo al monitoreo en vivo: los arbitrajes reales son raros, así que esperaré pacientemente. 🐾",
    en: "Demo mode off. Back to live monitoring: real arbs are rare, so I'll wait patiently. 🐾",
  } as Bilingual,
  feedDown: (venue: string): Bilingual => ({
    es: `Se cayó el feed de ${venue}; dejo de considerar ese venue hasta que reconecte.`,
    en: `${venue}'s feed dropped; I'll stop considering that venue until it reconnects.`,
  }),
  best: (o: Opportunity): Bilingual => ({
    es: `Mejor oportunidad accionable: comprar en ${cap(o.buyExchange)}, vender en ${cap(o.sellExchange)} · neto ${sUsd(o.netProfit)} · EV ${sUsd(o.expectedValueUsd)} · P(superv) ${pct(o.survivalProb)}.`,
    en: `Best actionable opportunity: buy on ${cap(o.buyExchange)}, sell on ${cap(o.sellExchange)} · net ${sUsd(o.netProfit)} · EV ${sUsd(o.expectedValueUsd)} · P(surv) ${pct(o.survivalProb)}.`,
  }),
  skip: (o: Opportunity): Bilingual => ({
    es: `Descarté ${cap(o.buyExchange)}→${cap(o.sellExchange)}: bruto ${sUsd(o.grossProfit)} se ve bien, pero neto ${sUsd(o.netProfit)} tras fees y slippage. Decido por EV, no por spread. 🐾`,
    en: `Skipped ${cap(o.buyExchange)}→${cap(o.sellExchange)}: gross ${sUsd(o.grossProfit)} looks nice, but net ${sUsd(o.netProfit)} after fees and slippage. I decide by EV, not by spread. 🐾`,
  }),
  exec: (n: number, pnl: number, last: SimulatedTrade): Bilingual => {
    const route = `${cap(last.buyExchange)}→${cap(last.sellExchange)}`;
    return n === 1
      ? {
          es: `Ejecuté ${route} · P&L neto ${sUsd(pnl)}${last.partial ? " (fill parcial)" : ""}.`,
          en: `Executed ${route} · net P&L ${sUsd(pnl)}${last.partial ? " (partial fill)" : ""}.`,
        }
      : {
          es: `Ejecuté ${n} trades · P&L neto ${sUsd(pnl)} (último ${route}).`,
          en: `Executed ${n} trades · net P&L ${sUsd(pnl)} (last ${route}).`,
        };
  },
  residual: (t: SimulatedTrade): Bilingual => {
    const route = `${cap(t.buyExchange)}→${cap(t.sellExchange)}`;
    const rejected =
      t.buyLeg.state === "rejected"
        ? cap(t.buyExchange)
        : t.sellLeg.state === "rejected"
          ? cap(t.sellExchange)
          : null;
    const cause = rejected ? `rechazó la pata de ${rejected}` : "solo llenó una pata";
    const causeEn = rejected ? `${rejected}'s leg was rejected` : "only one leg filled";
    const action =
      t.resolution === "rehedged"
        ? { es: "completé la pata faltante (re-hedge)", en: "completed the missing leg (re-hedge)" }
        : { es: "deshice la pata llena (unwind)", en: "unwound the filled leg" };
    return {
      es: `${route}: ${cause} → residual ${t.residualBtc.toFixed(4)} BTC. ${action.es} y volví a plano · costo ${sUsd(t.resolutionPnlUsd)}. 🐾`,
      en: `${route}: ${causeEn} → residual ${t.residualBtc.toFixed(4)} BTC. I ${action.en} back to flat · cost ${sUsd(t.resolutionPnlUsd)}. 🐾`,
    };
  },
  scenario: (sc: EngineConfig["scenario"], active: boolean): Bilingual => {
    if (!active) {
      return {
        es: "Escenario adverso desactivado. Ejecución normal de nuevo. 🐾",
        en: "Adverse scenario off. Back to normal execution. 🐾",
      };
    }
    const parts: string[] = [];
    const partsEn: string[] = [];
    if (sc.rejectProb > 0) {
      parts.push(`rechazo de pata ${pct(sc.rejectProb)}`);
      partsEn.push(`leg reject ${pct(sc.rejectProb)}`);
    }
    if (sc.liquidityHaircutPct > 0) {
      parts.push(`liquidez −${pct(sc.liquidityHaircutPct)}`);
      partsEn.push(`liquidity −${pct(sc.liquidityHaircutPct)}`);
    }
    if (sc.priceGapBps > 0) {
      parts.push(`gap ${Math.round(sc.priceGapBps)} bps`);
      partsEn.push(`gap ${Math.round(sc.priceGapBps)} bps`);
    }
    return {
      es: `Modo escenario adverso ACTIVO (${parts.join(" · ")}). Es simulado y etiquetado; mira cómo vuelvo a plano. 🐾`,
      en: `Adverse scenario mode ON (${partsEn.join(" · ")}). It's simulated and labeled; watch me return to flat. 🐾`,
    };
  },
  digest: (
    s: StatsSnapshot | null,
    p: PortfolioStats | null,
    l: LatencyStats | null,
  ): Bilingual => {
    const esParts: string[] = [];
    const enParts: string[] = [];
    if (s && s.sampleCount > 0) {
      esParts.push(`escaneé ${fmt(s.sampleCount)} cruces (${fmt(s.opportunities.perMinute)}/min), ${s.opportunities.actionableRatePct}% accionables`);
      enParts.push(`scanned ${fmt(s.sampleCount)} crosses (${fmt(s.opportunities.perMinute)}/min), ${s.opportunities.actionableRatePct}% actionable`);
    }
    if (p) {
      esParts.push(`P&L ${sUsd(p.realizedPnlUsd)} en ${p.totalTrades} trades`);
      enParts.push(`P&L ${sUsd(p.realizedPnlUsd)} across ${p.totalTrades} trades`);
    }
    if (l) {
      esParts.push(`latencia p50 ${ms(l.processing.p50)}`);
      enParts.push(`latency p50 ${ms(l.processing.p50)}`);
    }
    return {
      es: `Resumen 🐾 ${esParts.join(" · ")}.`,
      en: `Digest 🐾 ${enParts.join(" · ")}.`,
    };
  },
};

/* ── Formatting helpers ────────────────────────────────────────────────── */

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function sUsd(n: number): string {
  return `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
}
function pct(frac: number): string {
  return `${(frac * 100).toFixed(0)}%`;
}
function sPct(frac: number): string {
  return `${frac >= 0 ? "+" : "−"}${(Math.abs(frac) * 100).toFixed(2)}%`;
}
function ms(n: number): string {
  if (n < 1) return `${(n * 1000).toFixed(0)}µs`;
  return `${n.toFixed(2)}ms`;
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
