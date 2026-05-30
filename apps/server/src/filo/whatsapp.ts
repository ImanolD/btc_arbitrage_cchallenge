import crypto from "node:crypto";
import { integrations } from "../config.js";

const wa = integrations.whatsapp;

/** Outbound sending is possible only with an API key + phone number id. */
export function whatsappEnabled(): boolean {
  return Boolean(wa.apiKey && wa.phoneNumberId);
}

/** The end-to-end feature (button + replies) needs a public number too. */
export function whatsappReady(): boolean {
  return whatsappEnabled() && Boolean(wa.displayNumber);
}

/** Click-to-chat deep link that opens WhatsApp with the opt-in keyword filled. */
export function whatsappLink(): string | null {
  if (!wa.displayNumber) return null;
  return `https://wa.me/${wa.displayNumber}?text=${encodeURIComponent(wa.keyword)}`;
}

export function whatsappKeyword(): string {
  return wa.keyword;
}

/** Send a plain-text WhatsApp message. Returns false on any failure. */
export async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  if (!whatsappEnabled()) return false;
  try {
    const res = await fetch(`${wa.base}/${wa.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": wa.apiKey as string,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body },
      }),
    });
    if (!res.ok) {
      console.warn(`[whatsapp] send ${res.status}:`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[whatsapp] send error:", (err as Error).message);
    return false;
  }
}

/**
 * Verify an inbound webhook's HMAC-SHA256 signature against the raw body.
 * When no secret is configured we can't verify, so we accept (dev/no-config).
 */
export function verifyWebhook(rawBody: string, signature: string | undefined): boolean {
  if (!wa.webhookSecret) return true;
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", wa.webhookSecret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
