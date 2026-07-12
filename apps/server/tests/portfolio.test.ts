import { describe, expect, test } from "bun:test";
import { Portfolio } from "../src/engine/portfolio.js";
import { makeConfig, makeTrade } from "./helpers.js";

const PRICE = 100_000;
const START_BTC = 2;
const START_USD = 100_000;

function setup(band = 0.5) {
  const config = makeConfig({ rebalanceThresholdBtc: band });
  const portfolio = new Portfolio(["binance", "kraken"], START_USD, START_BTC, PRICE, config);
  return { config, portfolio };
}

describe("Portfolio — (s,S) rebalancing with deadband", () => {
  test("no transfer while inventory stays inside the band", () => {
    const { portfolio } = setup(0.5);
    // Drift binance +0.3 BTC (to 2.3, below the 2.5 ceiling) — inside the band.
    portfolio.applyTrade(
      makeTrade([
        { exchange: "binance", usd: -30_000, btc: 0.3 },
        { exchange: "kraken", usd: 30_150, btc: -0.3 },
      ]),
      PRICE,
    );

    const s = portfolio.stats(PRICE);
    expect(s.rebalancing.events).toBe(0);
    expect(s.rebalancing.recentEvents).toHaveLength(0);
  });

  test("crossing the ceiling ships the excess back to the target (S)", () => {
    const { portfolio } = setup(0.5);
    // Drift binance +0.8 BTC (to 2.8, above the 2.5 ceiling); kraken −0.8 (to 1.2).
    portfolio.applyTrade(
      makeTrade([
        { exchange: "binance", usd: -80_000, btc: 0.8 },
        { exchange: "kraken", usd: 80_400, btc: -0.8 },
      ]),
      PRICE,
    );

    const s = portfolio.stats(PRICE);
    expect(s.rebalancing.events).toBe(1);
    expect(s.rebalancing.recentEvents).toHaveLength(1);

    const evt = s.rebalancing.recentEvents[0];
    expect(evt.fromExchange).toBe("binance");
    expect(evt.toExchange).toBe("kraken");
    // Returns to the target (2.0), not merely to the ceiling ⇒ moves 0.8 BTC.
    expect(evt.amountBtc).toBeCloseTo(0.8, 6);

    const binance = s.wallets.find((w) => w.exchange === "binance")!;
    expect(binance.btc).toBeCloseTo(START_BTC, 6); // back to target S = 2.0

    // The withdrawal fee is the only per-trade transfer cost booked.
    expect(s.rebalancing.totalCostUsd).toBeGreaterThan(0);
  });

  test("applyTrade credits realized P&L and win rate", () => {
    const { portfolio } = setup(0.5);
    portfolio.applyTrade(
      makeTrade(
        [
          { exchange: "binance", usd: -30_000, btc: 0.3 },
          { exchange: "kraken", usd: 30_150, btc: -0.3 },
        ],
        150, // net profit
      ),
      PRICE,
    );

    const s = portfolio.stats(PRICE);
    expect(s.totalTrades).toBe(1);
    expect(s.realizedPnlUsd).toBeCloseTo(150, 6);
    expect(s.winRate).toBe(1);
  });

  test("drift forecast projects trades-to-breach once warmed up", () => {
    const { portfolio } = setup(0.5);
    // Six small BTC-accumulating trades (stays inside the band, no rebalance).
    for (let k = 0; k < 6; k += 1) {
      portfolio.applyTrade(
        makeTrade([
          { exchange: "binance", usd: -5_000, btc: 0.05 },
          { exchange: "kraken", usd: 5_025, btc: -0.05 },
        ]),
        PRICE,
      );
    }

    const s = portfolio.stats(PRICE);
    const binance = s.inventory.find((w) => w.exchange === "binance")!;
    const kraken = s.inventory.find((w) => w.exchange === "kraken")!;

    // Binance is accumulating BTC (drift up) with a finite horizon to its ceiling.
    expect(binance.driftPerTradeBtc).toBeGreaterThan(0);
    expect(binance.projectedTradesToBreach).not.toBeNull();
    expect(binance.projectedTradesToBreach!).toBeGreaterThan(0);
    // Kraken is bleeding BTC (drift down toward its floor).
    expect(kraken.driftPerTradeBtc).toBeLessThan(0);
  });

  test("drift forecast is null before warm-up", () => {
    const { portfolio } = setup(0.5);
    portfolio.applyTrade(
      makeTrade([
        { exchange: "binance", usd: -5_000, btc: 0.05 },
        { exchange: "kraken", usd: 5_025, btc: -0.05 },
      ]),
      PRICE,
    );

    const s = portfolio.stats(PRICE);
    const binance = s.inventory.find((w) => w.exchange === "binance")!;
    // Only one sample ⇒ not enough to trust a projection yet.
    expect(binance.projectedTradesToBreach).toBeNull();
  });

  test("capacity is bounded by USD to buy and BTC to sell", () => {
    const { portfolio } = setup();
    const cap = portfolio.capacity("binance", "kraken", PRICE);
    expect(cap.maxByUsd).toBeCloseTo(START_USD / PRICE, 6);
    expect(cap.maxByBtc).toBeCloseTo(START_BTC, 6);
  });
});
