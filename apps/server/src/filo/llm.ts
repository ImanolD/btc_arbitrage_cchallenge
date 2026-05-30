import type { FiloLang } from "@arb/shared";

/**
 * Optional Claude layer for Filo's free-form answers. It is strictly grounded:
 * the model only ever sees the JSON state we hand it and is instructed never to
 * invent numbers. The whole layer is best-effort — if the key is missing, the
 * request times out, or the API errors, callers fall back to the deterministic
 * answer so a live demo never depends on a remote call.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 7_000;

/** Whether the LLM layer is configured (an Anthropic key is present). */
export function llmEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function systemPrompt(lang: FiloLang): string {
  const language = lang === "es" ? "Spanish" : "English";
  return [
    "You are Filo, the friendly cat mascot and voice of Filobot, a real-time",
    "cross-exchange Bitcoin arbitrage bot. You explain what the bot is doing to",
    "people watching its dashboard.",
    "",
    "Hard rules:",
    "- Answer ONLY using the JSON state provided in the user message.",
    "- NEVER invent or estimate numbers. If a figure is not in the state, say you",
    "  don't track that yet rather than guessing.",
    "- Be concise: 2–4 sentences. Precise, a little playful (you're a cat), never",
    "  hypey. You simulate execution; you don't give financial advice.",
    `- Reply in ${language}.`,
    "",
    "Domain notes you may rely on: the bot decides by EXPECTED VALUE",
    "(P(survival) × net − adverse cost), not a raw spread threshold. Most gross",
    "crosses die after fees, latency and slippage — that's expected and honest.",
    "It uses an inventory model (capital pre-positioned on each venue), so",
    "withdrawal fees are an amortized rebalancing cost, not a per-trade cost.",
  ].join("\n");
}

/**
 * Ask Claude to answer `question` grounded in `context`. Returns the answer
 * text, or `null` on any failure (missing key, timeout, API/parse error).
 */
export async function llmAnswer(
  question: string,
  lang: FiloLang,
  context: unknown,
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const model = process.env.FILO_MODEL ?? "claude-3-5-haiku-latest";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 320,
        system: systemPrompt(lang),
        messages: [
          {
            role: "user",
            content:
              `Question: ${question}\n\n` +
              `Live bot state (the only source of truth):\n` +
              "```json\n" +
              JSON.stringify(context) +
              "\n```",
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[filo] llm http ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content
      ?.filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("")
      .trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    // Aborted timeouts and network errors both land here — fall back silently.
    console.warn("[filo] llm error", (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
