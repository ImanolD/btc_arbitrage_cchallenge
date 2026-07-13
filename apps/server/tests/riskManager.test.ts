import { describe, expect, test } from "bun:test";
import type { ArbCalc } from "../src/engine/profit.js";
import { RiskManager } from "../src/engine/riskManager.js";
import { makeBook, makeConfig } from "./helpers.js";

const NOW = 1_000_000;

/** A healthy ArbCalc that would pass min-net-profit on its own. */
function calc(over: Partial<ArbCalc> = {}): ArbCalc {
  return {
    size: 1,
    avgBuyPrice: 100_000,
    avgSellPrice: 100_200,
    cost: 100_000,
    revenue: 100_200,
    fees: 0,
    grossProfit: 200,
    netProfit: 200,
    ...over,
  };
}

describe("RiskManager — feed-dislocation (consensus) guard", () => {
  test("passes when both venues sit near the consensus", () => {
    const risk = new RiskManager(makeConfig());
    // Buy 100k, sell 100.2k; consensus ~100.1k ⇒ both within 1%.
    const buyBook = makeBook("binance", 99_990, 100_000);
    const sellBook = makeBook("kraken", 100_200, 100_210);

    const d = risk.evaluate(calc(), buyBook, sellBook, NOW, 100_100);
    expect(d.ok).toBe(true);
  });

  test("rejects a route whose venue is dislocated from consensus", () => {
    const risk = new RiskManager(makeConfig());
    // Sell venue is ~3% above the consensus (100k) — a lagging/bad feed, not a
    // real edge. The fat gross cross must NOT become actionable.
    const buyBook = makeBook("binance", 99_990, 100_000);
    const sellBook = makeBook("kraken", 103_000, 103_010);

    const d = risk.evaluate(calc({ avgSellPrice: 103_000, revenue: 103_000, grossProfit: 3_000, netProfit: 3_000 }), buyBook, sellBook, NOW, 100_000);
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("dislocated feed");
    expect(d.reason).toContain("kraken");
  });

  test("guard is inactive without a consensus quorum (null)", () => {
    const risk = new RiskManager(makeConfig());
    const buyBook = makeBook("binance", 99_990, 100_000);
    const sellBook = makeBook("kraken", 103_000, 103_010);

    // No consensus ⇒ dislocation guard can't run; the 3% cross (< 5% sane
    // spread, positive net) falls through the remaining gates and passes.
    const d = risk.evaluate(
      calc({ avgSellPrice: 103_000, revenue: 103_000, grossProfit: 3_000, netProfit: 3_000 }),
      buyBook,
      sellBook,
      NOW,
      null,
    );
    expect(d.ok).toBe(true);
    expect(d.reason ?? "").not.toContain("dislocated feed");
  });

  test("demo venue is exempt (intentionally dislocated for demo mode)", () => {
    const risk = new RiskManager(makeConfig());
    const buyBook = makeBook("demo", 99_990, 100_000);
    const sellBook = makeBook("kraken", 103_000, 103_010);

    const d = risk.evaluate(
      calc({ avgSellPrice: 103_000, revenue: 103_000, grossProfit: 3_000, netProfit: 3_000 }),
      buyBook,
      sellBook,
      NOW,
      100_000,
    );
    // Not rejected for dislocation (demo is exempt).
    expect(d.reason ?? "").not.toContain("dislocated feed");
  });

  test("stale quote is rejected before the dislocation check", () => {
    const risk = new RiskManager(makeConfig({ maxQuoteAgeMs: 2_000 }));
    const buyBook = { ...makeBook("binance", 99_990, 100_000), receivedAt: NOW - 5_000 };
    const sellBook = makeBook("kraken", 100_200, 100_210);

    const d = risk.evaluate(calc(), buyBook, sellBook, NOW, 100_100);
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("stale quote");
  });
});
