import { randomUUID } from "node:crypto";
import type { Opportunity, SimulatedTrade, TopOfBook } from "@arb/shared";
import { feeModels } from "../config.js";
import type { Portfolio } from "./portfolio.js";
import { computeArbitrage } from "./profit.js";

/**
 * Simulates execution of an actionable opportunity against the LIVE books at
 * execution time (not the snapshot from detection — the market may have moved).
 * Handles partial fills when either order-book depth or wallet balance can't
 * cover the full size.
 */
export class ExecutionSimulator {
  constructor(private readonly portfolio: Portfolio) {}

  execute(
    opp: Opportunity,
    buyBook: TopOfBook,
    sellBook: TopOfBook,
  ): SimulatedTrade | null {
    const buyFee = feeModels[opp.buyExchange].takerFee;
    const sellFee = feeModels[opp.sellExchange].takerFee;

    // Cap by available wallet balances (inventory model).
    const cap = this.portfolio.capacity(
      opp.buyExchange,
      opp.sellExchange,
      buyBook.bestAsk,
    );
    const balanceCappedNotional =
      Math.min(cap.maxByUsd, cap.maxByBtc) * buyBook.bestAsk;
    if (balanceCappedNotional <= 0) return null;

    // Re-walk against the current books, capped by balance-limited notional.
    const calc = computeArbitrage(
      buyBook.asks,
      sellBook.bids,
      buyFee,
      sellFee,
      Math.min(opp.size * buyBook.bestAsk, balanceCappedNotional),
    );

    if (calc.size <= 0 || calc.netProfit <= 0) return null;

    const trade: SimulatedTrade = {
      id: randomUUID(),
      opportunityId: opp.id,
      symbol: opp.symbol,
      buyExchange: opp.buyExchange,
      sellExchange: opp.sellExchange,
      filledSize: round8(calc.size),
      requestedSize: round8(opp.size),
      avgBuyPrice: round2(calc.avgBuyPrice),
      avgSellPrice: round2(calc.avgSellPrice),
      fees: round2(calc.fees),
      netProfit: round2(calc.netProfit),
      partial: calc.size < opp.size - 1e-8,
      executedAt: Date.now(),
    };
    return trade;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
