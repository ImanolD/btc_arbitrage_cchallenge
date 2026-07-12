import { describe, expect, test } from "bun:test";
import type { BookLevel } from "@arb/shared";
import { computeArbitrage } from "../src/engine/profit.js";

const FEE = 0.001; // 0.1% taker both sides

describe("computeArbitrage — net-of-everything depth walk", () => {
  test("profitable cross fills and nets positive after fees", () => {
    const buyAsks: BookLevel[] = [[100_000, 5]];
    const sellBids: BookLevel[] = [[100_500, 5]];

    const r = computeArbitrage(buyAsks, sellBids, FEE, FEE, 1_000_000);

    expect(r.size).toBeGreaterThan(0);
    expect(r.avgBuyPrice).toBeCloseTo(100_000, 6);
    expect(r.avgSellPrice).toBeCloseTo(100_500, 6);
    // fees are charged on both notional legs.
    expect(r.fees).toBeCloseTo(r.cost * FEE + r.revenue * FEE, 6);
    expect(r.netProfit).toBeCloseTo(r.grossProfit - r.fees, 6);
    expect(r.netProfit).toBeGreaterThan(0);
  });

  test("no fill when the cross is negative (ask above bid)", () => {
    const buyAsks: BookLevel[] = [[100_500, 5]];
    const sellBids: BookLevel[] = [[100_000, 5]];

    const r = computeArbitrage(buyAsks, sellBids, FEE, FEE, 1_000_000);

    expect(r.size).toBe(0);
    expect(r.netProfit).toBe(0);
  });

  test("no fill when a thin positive gross is eaten entirely by fees", () => {
    // 2 bps gross gap, but 10 bps + 10 bps of fees ⇒ never net-positive.
    const buyAsks: BookLevel[] = [[100_000, 5]];
    const sellBids: BookLevel[] = [[100_020, 5]];

    const r = computeArbitrage(buyAsks, sellBids, FEE, FEE, 1_000_000);

    expect(r.size).toBe(0);
  });

  test("stops walking once a deeper level turns unprofitable", () => {
    // Level 1 is a fat, clearly-profitable cross; level 2 inverts.
    const buyAsks: BookLevel[] = [
      [100_000, 1],
      [101_000, 10], // buying here would cost more than we could sell for
    ];
    const sellBids: BookLevel[] = [
      [100_800, 1],
      [100_100, 10],
    ];

    const r = computeArbitrage(buyAsks, sellBids, FEE, FEE, 10_000_000);

    // Only the first (1 BTC) level should be taken.
    expect(r.size).toBeCloseTo(1, 6);
    expect(r.avgBuyPrice).toBeCloseTo(100_000, 6);
  });

  test("respects the notional budget cap", () => {
    const buyAsks: BookLevel[] = [[100_000, 100]];
    const sellBids: BookLevel[] = [[100_500, 100]];

    // Budget only covers ~2 BTC worth of buying.
    const r = computeArbitrage(buyAsks, sellBids, FEE, FEE, 200_000);

    expect(r.size).toBeLessThanOrEqual(2 + 1e-6);
    expect(r.cost).toBeLessThanOrEqual(200_000 + 1e-6);
  });
});
