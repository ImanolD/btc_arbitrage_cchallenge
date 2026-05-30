import type { QuoteAsset } from "@arb/shared";

/** Known quote suffixes, checked longest-first so USDT wins over USD. */
const QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH"] as const;

export interface ParsedPair {
  base: string;
  quote: string;
}

/**
 * Parse a generic concatenated symbol (e.g. "BTCUSDT", "ETHBTC") into base and
 * quote. Connectors take this generic form and re-format it to their own
 * convention, so the rest of the system speaks one symbol language.
 */
export function parsePair(symbol: string): ParsedPair {
  const s = symbol.toUpperCase().replace(/[-_/]/g, "");
  for (const q of QUOTES) {
    if (s.endsWith(q) && s.length > q.length) {
      return { base: s.slice(0, -q.length), quote: q };
    }
  }
  // Fallback: assume a 3-char quote.
  return { base: s.slice(0, -3), quote: s.slice(-3) };
}

/** The QuoteAsset for grouping. Non-fiat quotes (BTC/ETH) are not used for the
 * cross-exchange BTC books, so we only ever surface USDT/USD/USDC here. */
export function quoteAssetOf(symbol: string): QuoteAsset {
  const { quote } = parsePair(symbol);
  if (quote === "USD") return "USD";
  if (quote === "USDC") return "USDC";
  return "USDT";
}
