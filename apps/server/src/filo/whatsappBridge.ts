import type { FiloMessage } from "@arb/shared";
import { integrations } from "../config.js";
import { createStorage, type Storage, type SubLang, type Subscriber } from "../storage/index.js";
import type { FiloAgent } from "./filoAgent.js";
import { sendWhatsApp, whatsappEnabled, whatsappKeyword } from "./whatsapp.js";

/** WhatsApp's free-form service window: 24h since the user's last inbound. */
const WINDOW_MS = 24 * 60 * 60 * 1000;
const OTHER: Record<SubLang, SubLang> = { es: "en", en: "es" };

const STOP_WORDS = new Set(["stop", "baja", "cancelar", "unsubscribe", "salir"]);
const EN_WORDS = new Set(["en", "english", "ingles", "inglés"]);
const ES_WORDS = new Set(["es", "espanol", "español", "spanish"]);
const GREETING_WORDS = new Set(["hola", "hi", "hello", "start", "hey", "buenas"]);

const WELCOME: Record<SubLang, string> = {
  es:
    "🐾 ¡Hola! Soy *Filo*, el copiloto del bot de arbitraje. Te avisaré en vivo cuando pase algo relevante (mejores oportunidades, ejecuciones, alertas). " +
    "Pregúntame lo que quieras (P&L, latencia, oportunidades). Escribe *BAJA* para dejar de recibir mensajes, o *EN* para inglés.",
  en:
    "🐾 Hi! I'm *Filo*, the arbitrage bot's copilot. I'll ping you live when something relevant happens (best opportunities, executions, alerts). " +
    "Ask me anything (P&L, latency, opportunities). Send *STOP* to unsubscribe, or *ES* for Spanish.",
};

const GOODBYE: Record<SubLang, string> = {
  es: "Listo, no recibirás más mensajes. Escríbeme cuando quieras para reactivarlos. 🐾",
  en: "Done, you won't get more messages. Message me anytime to turn them back on. 🐾",
};

/**
 * Bridges Filo to WhatsApp (transport-agnostic brain, new transport). Outbound:
 * forwards Filo's unprompted narrations to opted-in subscribers, throttled per
 * person and only inside the 24h window. Inbound: routes questions to Filo's
 * same deterministic+LLM brain and replies. All of this is OFF the hot path.
 */
export class WhatsAppBridge {
  private storage: Storage | null = null;
  private readonly subs = new Map<string, Subscriber>();
  private readonly minPushMs = integrations.whatsapp.minPushIntervalSec * 1000;

  constructor(private readonly filo: FiloAgent) {}

  async start(): Promise<void> {
    if (!whatsappEnabled()) {
      console.log("[whatsapp] disabled (no KAPSO_API_KEY / phone id)");
      return;
    }
    this.storage = await createStorage();
    for (const s of await this.storage.loadSubscribers()) this.subs.set(s.phone, s);
    if (this.subs.size) console.log(`[whatsapp] loaded ${this.subs.size} subscriber(s)`);
    this.filo.on("message", (msg) => void this.onFiloMessage(msg));
    console.log("[whatsapp] bridge active");
  }

  async stop(): Promise<void> {
    await this.storage?.close();
  }

  activeCount(): number {
    let n = 0;
    for (const s of this.subs.values()) if (s.active) n++;
    return n;
  }

  /** Handle a verified inbound webhook payload from Kapso. */
  async handleWebhook(body: any): Promise<void> {
    if (!body || body.event !== "whatsapp.message.received") return;
    const msg = body.message;
    const from = String(msg?.from ?? "").replace(/[^0-9]/g, "");
    const text = typeof msg?.text?.body === "string" ? msg.text.body : "";
    if (!from || !text) return;
    await this.onInbound(from, text);
  }

  private async onInbound(phone: string, rawText: string): Promise<void> {
    const text = rawText.trim();
    const lower = text.toLowerCase();
    const existing = this.subs.get(phone);
    let lang: SubLang = existing?.lang ?? "es";
    if (EN_WORDS.has(lower)) lang = "en";
    else if (ES_WORDS.has(lower)) lang = "es";

    // Unsubscribe.
    if (STOP_WORDS.has(lower)) {
      if (existing) {
        existing.active = false;
        await this.persist(existing);
      }
      await sendWhatsApp(phone, GOODBYE[lang]);
      return;
    }

    const now = Date.now();
    const wasInactive = !existing || !existing.active;
    const sub: Subscriber = existing ?? {
      phone,
      lang,
      active: true,
      createdAt: now,
      lastInboundAt: now,
      lastPushAt: 0,
    };
    sub.active = true;
    sub.lang = lang;
    sub.lastInboundAt = now;
    await this.persist(sub);

    if (wasInactive) await sendWhatsApp(phone, WELCOME[lang]);

    // Only run the (possibly LLM-backed) answer for real questions, not the
    // opt-in keyword / language toggle / bare greeting.
    const isControl =
      lower === whatsappKeyword().toLowerCase() ||
      EN_WORDS.has(lower) ||
      ES_WORDS.has(lower) ||
      GREETING_WORDS.has(lower);
    if (wasInactive && isControl) return;

    try {
      const answer = await this.filo.ask(text.slice(0, 500), lang);
      const reply = answer.text[lang] ?? answer.text[OTHER[lang]];
      if (reply) await sendWhatsApp(phone, reply);
    } catch (err) {
      console.warn("[whatsapp] answer failed:", (err as Error).message);
    }
  }

  private async onFiloMessage(msg: FiloMessage): Promise<void> {
    if (!whatsappEnabled() || this.subs.size === 0) return;
    const now = Date.now();
    for (const sub of this.subs.values()) {
      if (!sub.active) continue;
      if (now - sub.lastInboundAt > WINDOW_MS) continue; // window closed
      if (now - sub.lastPushAt < this.minPushMs) continue; // throttled
      const body = msg.text[sub.lang] ?? msg.text[OTHER[sub.lang]];
      if (!body) continue;
      const ok = await sendWhatsApp(sub.phone, `🤖 ${body}`);
      if (ok) {
        sub.lastPushAt = now;
        await this.persist(sub);
      }
    }
  }

  private async persist(sub: Subscriber): Promise<void> {
    this.subs.set(sub.phone, sub);
    try {
      await this.storage?.saveSubscriber(sub);
    } catch (err) {
      console.warn("[whatsapp] persist failed:", (err as Error).message);
    }
  }
}
