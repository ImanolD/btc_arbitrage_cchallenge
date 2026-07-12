import { describe, expect, test } from "bun:test";
import { ExecutionSimulator } from "../src/engine/executionSimulator.js";
import { Portfolio } from "../src/engine/portfolio.js";
import { makeBook, makeConfig, makeOpp, stubRandom } from "./helpers.js";

const PRICE = 100_000;

function setup(configOver = {}) {
  const config = makeConfig(configOver);
  const portfolio = new Portfolio(["binance", "kraken"], 10_000_000, 100, PRICE, config);
  const sim = new ExecutionSimulator(portfolio, config);
  return { config, portfolio, sim };
}

/** Total BTC across all wallet deltas — must be ~0 when the desk returns flat. */
function netBtc(deltas: { btc: number }[]): number {
  return deltas.reduce((s, d) => s + d.btc, 0);
}

describe("ExecutionSimulator — two-leg state machine", () => {
  test("normal execution: both legs fill, position ends flat and profitable", () => {
    const { sim } = setup();
    const buyBook = makeBook("binance", 99_990, 100_000);
    const sellBook = makeBook("kraken", 100_500, 100_510);

    const trade = sim.execute(makeOpp(), buyBook, sellBook);

    expect(trade).not.toBeNull();
    expect(trade!.buyLeg.state).toBe("filled");
    expect(trade!.sellLeg.state).toBe("filled");
    expect(trade!.residualBtc).toBe(0);
    expect(trade!.resolution).toBe("none");
    expect(trade!.finalState).toBe("flat");
    expect(trade!.netProfit).toBeGreaterThan(0);
    // BTC is conserved: what we bought we sold.
    expect(netBtc(trade!.walletDeltas)).toBeCloseTo(0, 6);
  });

  test("rejected leg leaves a residual that is resolved back to flat", () => {
    const { sim } = setup({ scenario: { rejectProb: 0.5, liquidityHaircutPct: 0, priceGapBps: 0 } });
    const buyBook = makeBook("binance", 99_990, 100_000);
    const sellBook = makeBook("kraken", 100_500, 100_510);

    // First random ⇒ buy leg rejected (<0.5); second ⇒ sell leg survives (>0.5).
    const restore = stubRandom([0.1, 0.9]);
    let trade;
    try {
      trade = sim.execute(makeOpp(), buyBook, sellBook);
    } finally {
      restore();
    }

    expect(trade).not.toBeNull();
    expect(trade!.buyLeg.state).toBe("rejected");
    expect(trade!.sellLeg.state).toBe("filled");
    // One leg filled ⇒ a directional residual existed and was resolved.
    expect(Math.abs(trade!.residualBtc)).toBeGreaterThan(0);
    expect(trade!.resolution).not.toBe("none");
    expect(trade!.finalState).toBe("flat");
    // Whatever path was taken, we end flat: net BTC ≈ 0.
    expect(netBtc(trade!.walletDeltas)).toBeCloseTo(0, 6);
  });

  test("both legs rejected ⇒ no position taken, no trade booked", () => {
    const { sim } = setup({ scenario: { rejectProb: 1, liquidityHaircutPct: 0, priceGapBps: 0 } });
    const buyBook = makeBook("binance", 99_990, 100_000);
    const sellBook = makeBook("kraken", 100_500, 100_510);

    const trade = sim.execute(makeOpp(), buyBook, sellBook);
    expect(trade).toBeNull();
  });

  test("liquidity haircut shrinks the fillable size and is tagged", () => {
    const { sim } = setup({
      scenario: { rejectProb: 0, liquidityHaircutPct: 0.5, priceGapBps: 0 },
    });
    // 5 BTC of depth per level; opp wants 10 ⇒ book depth is the binding limit.
    const buyBook = makeBook("binance", 99_990, 100_000, 5);
    const sellBook = makeBook("kraken", 100_500, 100_510, 5);

    const trade = sim.execute(makeOpp({ size: 10 }), buyBook, sellBook);

    expect(trade).not.toBeNull();
    expect(trade!.scenarioTags).toContain("liquidity");
    // Depth 5 haircut 50% ⇒ ~2.5 BTC fillable, not the requested 10.
    expect(trade!.filledSize).toBeCloseTo(2.5, 2);
    expect(trade!.finalState).toBe("flat");
  });
});
