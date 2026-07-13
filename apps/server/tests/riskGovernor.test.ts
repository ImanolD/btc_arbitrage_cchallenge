import { describe, expect, test } from "bun:test";
import type { ExchangeId, SimulatedTrade } from "@arb/shared";
import { RiskGovernor } from "../src/engine/riskGovernor.js";
import { makeConfig, makeTrade } from "./helpers.js";

/** A trade whose buy and/or sell leg was rejected (0 fill). */
function rejectedTrade(opts: { buy?: ExchangeId; sell?: ExchangeId; rejectBuy?: boolean; rejectSell?: boolean }): SimulatedTrade {
  const t = makeTrade([], 0);
  t.buyExchange = opts.buy ?? "binance";
  t.sellExchange = opts.sell ?? "kraken";
  t.buyLeg = { ...t.buyLeg, exchange: t.buyExchange, state: opts.rejectBuy ? "rejected" : "filled" };
  t.sellLeg = { ...t.sellLeg, exchange: t.sellExchange, state: opts.rejectSell ? "rejected" : "filled" };
  return t;
}

describe("RiskGovernor — per-venue circuit breaker", () => {
  test("trips a venue after N rejects within the window, then benches it", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 3, breakerWindowMs: 10_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 0 },
    }));
    let now = 1_000_000;
    // Two rejects: not yet tripped.
    expect(gov.recordTrade(rejectedTrade({ rejectBuy: true }), now)).toEqual([]);
    expect(gov.recordTrade(rejectedTrade({ rejectBuy: true }), (now += 1_000))).toEqual([]);
    expect(gov.isBenched("binance", now)).toBe(false);
    // Third reject within the window trips it.
    expect(gov.recordTrade(rejectedTrade({ rejectBuy: true }), (now += 1_000))).toEqual(["binance"]);
    expect(gov.isBenched("binance", now)).toBe(true);
  });

  test("does not count rejects that fall outside the rolling window", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 3, breakerWindowMs: 5_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 0 },
    }));
    let now = 1_000_000;
    gov.recordTrade(rejectedTrade({ rejectBuy: true }), now);
    gov.recordTrade(rejectedTrade({ rejectBuy: true }), now + 1_000);
    // Third reject arrives after the first has aged out of the 5s window.
    const benched = gov.recordTrade(rejectedTrade({ rejectBuy: true }), now + 7_000);
    expect(benched).toEqual([]);
    expect(gov.isBenched("binance", now + 7_000)).toBe(false);
  });

  test("a benched venue auto-recovers once its cooldown elapses", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 2, breakerWindowMs: 10_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 0 },
    }));
    const now = 1_000_000;
    gov.recordTrade(rejectedTrade({ rejectBuy: true }), now);
    gov.recordTrade(rejectedTrade({ rejectBuy: true }), now + 500);
    expect(gov.isBenched("binance", now + 600)).toBe(true);
    // Still benched inside the cooldown, recovered after it.
    expect(gov.isBenched("binance", now + 14_000)).toBe(true);
    expect(gov.isBenched("binance", now + 16_000)).toBe(false);
  });

  test("filled legs never trip the breaker", () => {
    const gov = new RiskGovernor(makeConfig());
    let now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(gov.recordTrade(rejectedTrade({}), (now += 100))).toEqual([]);
    }
    expect(gov.isBenched("binance", now)).toBe(false);
  });

  test("breakerRejects = 0 disables the breaker entirely", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 0, breakerWindowMs: 10_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 0 },
    }));
    let now = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      gov.recordTrade(rejectedTrade({ rejectBuy: true }), (now += 100));
    }
    expect(gov.isBenched("binance", now)).toBe(false);
  });
});

describe("RiskGovernor — session loss-limit kill-switch", () => {
  test("halts when realized P&L breaches −limit and resumes when it recovers", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 0, breakerWindowMs: 10_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 500 },
    }));
    expect(gov.updateHalt(-100)).toBeNull();
    expect(gov.isHalted()).toBe(false);
    expect(gov.updateHalt(-600)).toBe("halted");
    expect(gov.isHalted()).toBe(true);
    // No transition while it stays halted.
    expect(gov.updateHalt(-700)).toBeNull();
    // Recovers above the limit.
    expect(gov.updateHalt(-100)).toBe("resumed");
    expect(gov.isHalted()).toBe(false);
  });

  test("maxSessionLossUsd = 0 disables the kill-switch", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 0, breakerWindowMs: 10_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 0 },
    }));
    expect(gov.updateHalt(-1_000_000)).toBeNull();
    expect(gov.isHalted()).toBe(false);
  });

  test("state() reports benched venues and halt reason", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 1, breakerWindowMs: 10_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 500 },
    }));
    const now = 1_000_000;
    gov.recordTrade(rejectedTrade({ rejectSell: true, sell: "kraken" }), now);
    gov.updateHalt(-600);
    const s = gov.state(now);
    expect(s.benched).toContain("kraken");
    expect(s.halted).toBe(true);
    expect(s.haltReason).toBeDefined();
  });

  test("reset clears breaker and halt state", () => {
    const gov = new RiskGovernor(makeConfig({
      riskLimits: { breakerRejects: 1, breakerWindowMs: 10_000, breakerCooldownMs: 15_000, maxSessionLossUsd: 500 },
    }));
    const now = 1_000_000;
    gov.recordTrade(rejectedTrade({ rejectBuy: true }), now);
    gov.updateHalt(-600);
    gov.reset();
    expect(gov.isHalted()).toBe(false);
    expect(gov.isBenched("binance", now)).toBe(false);
    expect(gov.state(now).benched).toEqual([]);
  });
});
