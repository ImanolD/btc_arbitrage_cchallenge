import type { BookLevel } from "@arb/shared";

const EPS = 1e-9;

export interface ArbCalc {
  /** Executable base size (BTC) while the trade stays net-positive per level. */
  size: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  /** Total quote spent buying (before fees). */
  cost: number;
  /** Total quote received selling (before fees). */
  revenue: number;
  fees: number;
  grossProfit: number;
  netProfit: number;
}

/**
 * Walk both order books level-by-level to find the size that maximises net
 * profit, stopping as soon as the marginal fill stops being profitable after
 * fees, and respecting the notional budget.
 *
 * This is the heart of "net-of-everything" accuracy: a trade that looks great
 * at top-of-book often goes negative two levels deep once slippage bites. We
 * never assume the best price fills the whole size.
 *
 * @param buyAsks  ascending-price asks of the exchange we BUY on
 * @param sellBids descending-price bids of the exchange we SELL on
 */
export function computeArbitrage(
  buyAsks: BookLevel[],
  sellBids: BookLevel[],
  buyFee: number,
  sellFee: number,
  maxNotionalUsd: number,
): ArbCalc {
  let i = 0;
  let j = 0;
  let askRemain = buyAsks[i]?.[1] ?? 0;
  let bidRemain = sellBids[j]?.[1] ?? 0;
  let budget = maxNotionalUsd;

  let size = 0;
  let cost = 0;
  let revenue = 0;

  while (i < buyAsks.length && j < sellBids.length && budget > EPS) {
    const askPrice = buyAsks[i][0];
    const bidPrice = sellBids[j][0];

    // Marginal profitability check INCLUDING fees, per unit.
    const effAsk = askPrice * (1 + buyFee);
    const effBid = bidPrice * (1 - sellFee);
    if (effAsk >= effBid) break;

    const budgetSize = budget / askPrice;
    const take = Math.min(askRemain, bidRemain, budgetSize);
    if (take <= EPS) break;

    size += take;
    cost += take * askPrice;
    revenue += take * bidPrice;
    askRemain -= take;
    bidRemain -= take;
    budget -= take * askPrice;

    if (askRemain <= EPS) {
      i += 1;
      askRemain = buyAsks[i]?.[1] ?? 0;
    }
    if (bidRemain <= EPS) {
      j += 1;
      bidRemain = sellBids[j]?.[1] ?? 0;
    }
  }

  const fees = cost * buyFee + revenue * sellFee;
  const grossProfit = revenue - cost;
  const netProfit = grossProfit - fees;

  return {
    size,
    avgBuyPrice: size > 0 ? cost / size : 0,
    avgSellPrice: size > 0 ? revenue / size : 0,
    cost,
    revenue,
    fees,
    grossProfit,
    netProfit,
  };
}
