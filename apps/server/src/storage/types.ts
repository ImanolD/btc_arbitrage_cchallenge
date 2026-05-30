export type SubLang = "es" | "en";

/**
 * A WhatsApp opt-in. Created when a visitor messages Filo (click-to-chat), which
 * is what gives consent AND opens WhatsApp's 24h service window for free-form
 * replies. We store the minimum needed to deliver updates.
 */
export interface Subscriber {
  /** E.164 digits only, no leading '+'. Doubles as the natural key. */
  phone: string;
  lang: SubLang;
  active: boolean;
  createdAt: number;
  /** Last inbound message time (ms) — drives the 24h free-form window. */
  lastInboundAt: number;
  /** Last unprompted push time (ms) — drives per-subscriber throttling. */
  lastPushAt: number;
}

/**
 * Persistence boundary. The default in-memory implementation keeps the server
 * fully clean-room; a Mongo implementation is used only when MONGODB_URI is set.
 * Nothing here is ever called from the detection/execution hot path.
 */
export interface Storage {
  loadSubscribers(): Promise<Subscriber[]>;
  saveSubscriber(sub: Subscriber): Promise<void>;
  close(): Promise<void>;
}
