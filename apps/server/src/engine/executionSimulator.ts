import { randomUUID } from "node:crypto";
import type {
  BookLevel,
  EngineConfig,
  Opportunity,
  OrderLegState,
  ResidualResolution,
  SimulatedTrade,
  TopOfBook,
  TradeLeg,
  WalletDelta,
} from "@arb/shared";
import type { Portfolio } from "./portfolio.js";
import { computeArbitrage } from "./profit.js";

const EPS = 1e-9;

/**
 * Simulates execution of an actionable opportunity against the LIVE books at
 * execution time (not the snapshot from detection — the market may have moved).
 *
 * Each execution is modeled as TWO independent order legs (buy + sell), each
 * with its own state (`filled` / `partial` / `rejected`). When the legs don't
 * match — a leg rejects, or liquidity/gaps only fill one side — a directional
 * **residual** remains, and the engine brings it back to **flat** by either
 * *re-hedging* (completing the missing leg) or *unwinding* (reversing the filled
 * leg), whichever is cheaper. This mirrors how a real desk never wants to be
 * left with naked directional exposure after a half-filled arb.
 *
 * The clearly-labeled **adverse-scenario injector** (`config.scenario`) can force
 * these failures on demand: leg rejects, a liquidity crunch (depth haircut), or
 * an adverse price gap mid-execution. All zero = normal execution.
 */
export class ExecutionSimulator {
  constructor(
    private readonly portfolio: Portfolio,
    private readonly config: EngineConfig,
  ) {}

  execute(
    opp: Opportunity,
    buyBook: TopOfBook,
    sellBook: TopOfBook,
  ): SimulatedTrade | null {
    const sc = this.config.scenario;
    const buyFee = this.config.fees[opp.buyExchange].takerFee;
    const sellFee = this.config.fees[opp.sellExchange].takerFee;
    const scenarioTags: string[] = [];

    // Cap by available wallet balances (inventory model).
    const cap = this.portfolio.capacity(opp.buyExchange, opp.sellExchange, buyBook.bestAsk);
    const balanceCappedNotional = Math.min(cap.maxByUsd, cap.maxByBtc) * buyBook.bestAsk;
    if (balanceCappedNotional <= 0) return null;

    // (a) Liquidity crunch: shrink the fillable depth before walking the book.
    const haircut = sc.liquidityHaircutPct;
    const buyAsks = haircut > 0 ? haircutLevels(buyBook.asks, haircut) : buyBook.asks;
    const sellBids = haircut > 0 ? haircutLevels(sellBook.bids, haircut) : sellBook.bids;
    if (haircut > 0) scenarioTags.push("liquidity");

    // Re-walk against the (possibly haircut) current books, capped by balance.
    const calc = computeArbitrage(
      buyAsks,
      sellBids,
      buyFee,
      sellFee,
      Math.min(opp.size * buyBook.bestAsk, balanceCappedNotional),
    );

    const scenarioActive =
      sc.rejectProb > 0 || haircut > 0 || sc.priceGapBps > 0;

    // Intended size + base execution prices. When the walk is unprofitable but a
    // scenario is active, we still *attempt* the opportunity size (models a desk
    // that already committed and then got hit) at top-of-book prices.
    let size = calc.size;
    let baseBuyPrice = calc.avgBuyPrice;
    let baseSellPrice = calc.avgSellPrice;
    if (size <= EPS) {
      if (!scenarioActive) return null;
      size = Math.min(opp.size, balanceCappedNotional / buyBook.bestAsk);
      baseBuyPrice = buyBook.bestAsk;
      baseSellPrice = sellBook.bestBid;
    }
    if (size <= EPS) return null;

    // (b) Adverse price gap mid-execution: buy fills higher, sell fills lower.
    const gap = sc.priceGapBps / 10_000;
    if (gap > 0) scenarioTags.push("gap");
    const buyPrice = baseBuyPrice * (1 + gap);
    const sellPrice = baseSellPrice * (1 - gap);

    // (c) Leg rejects: each leg independently either fills `size` or nothing.
    const rejectBuy = sc.rejectProb > 0 && Math.random() < sc.rejectProb;
    const rejectSell = sc.rejectProb > 0 && Math.random() < sc.rejectProb;
    if (rejectBuy) scenarioTags.push("reject:buy");
    if (rejectSell) scenarioTags.push("reject:sell");
    const buyFilled = rejectBuy ? 0 : size;
    const sellFilled = rejectSell ? 0 : size;

    // Nothing happened at all — no position taken, no trade to book.
    if (buyFilled <= EPS && sellFilled <= EPS) return null;

    // Per-wallet balance deltas accumulate across both legs + the resolution.
    const deltas = new Map<string, WalletDelta>();
    const bump = (exchange: string, usd: number, btc: number) => {
      const d = deltas.get(exchange) ?? { exchange: exchange as WalletDelta["exchange"], usd: 0, btc: 0 };
      d.usd += usd;
      d.btc += btc;
      deltas.set(exchange, d);
    };

    let feesPaid = 0;
    // Buy leg: pay USD + fee, receive BTC on the buy venue.
    if (buyFilled > EPS) {
      const notional = buyFilled * buyPrice;
      const fee = notional * buyFee;
      feesPaid += fee;
      bump(opp.buyExchange, -(notional + fee), buyFilled);
    }
    // Sell leg: deliver BTC, receive USD − fee on the sell venue.
    if (sellFilled > EPS) {
      const notional = sellFilled * sellPrice;
      const fee = notional * sellFee;
      feesPaid += fee;
      bump(opp.sellExchange, notional - fee, -sellFilled);
    }

    const matched = Math.min(buyFilled, sellFilled);
    const residual = round8(buyFilled - sellFilled); // signed; >0 = long, <0 = short

    // Residual resolution: bring any net directional exposure back to flat by
    // trading it on whichever venue/price is cheaper (re-hedge vs unwind).
    let resolution: ResidualResolution = "none";
    if (Math.abs(residual) > EPS) {
      if (residual > 0) {
        // Long extra BTC: sell |residual|. Re-hedge on the sell venue (its bid),
        // or unwind on the buy venue (its bid). Higher proceeds = cheaper flat.
        const rehedgePrice = sellPrice; // sell-venue bid, already gapped down
        const unwindPrice = buyBook.bestBid * (1 - gap);
        const useRehedge = rehedgePrice >= unwindPrice;
        const venue = useRehedge ? opp.sellExchange : opp.buyExchange;
        const price = useRehedge ? rehedgePrice : unwindPrice;
        const fee = residual * price * this.config.fees[venue].takerFee;
        feesPaid += fee;
        bump(venue, residual * price - fee, -residual);
        resolution = useRehedge ? "rehedged" : "unwound";
      } else {
        // Short: buy back |residual|. Re-hedge on the buy venue (its ask), or
        // unwind on the sell venue (its ask). Lower cost = cheaper flat.
        const need = -residual;
        const rehedgePrice = buyPrice; // buy-venue ask, already gapped up
        const unwindPrice = sellBook.bestAsk * (1 + gap);
        const useRehedge = rehedgePrice <= unwindPrice;
        const venue = useRehedge ? opp.buyExchange : opp.sellExchange;
        const price = useRehedge ? rehedgePrice : unwindPrice;
        const fee = need * price * this.config.fees[venue].takerFee;
        feesPaid += fee;
        bump(venue, -(need * price + fee), need);
        resolution = useRehedge ? "rehedged" : "unwound";
      }
    }

    // BTC is conserved to flat, so realized P&L is exactly the sum of USD deltas.
    const walletDeltas = [...deltas.values()];
    const netProfit = walletDeltas.reduce((s, d) => s + d.usd, 0);

    // Decompose: the clean matched-arb P&L vs. the drag from the residual mess.
    const cleanArbPnl =
      matched * (sellPrice - buyPrice) -
      matched * buyPrice * buyFee -
      matched * sellPrice * sellFee;
    const resolutionPnl = netProfit - cleanArbPnl;

    const buyLeg: TradeLeg = {
      side: "buy",
      exchange: opp.buyExchange,
      requestedSize: round8(size),
      filledSize: round8(buyFilled),
      avgPrice: round2(buyPrice),
      state: legState(rejectBuy, size, opp.size),
    };
    const sellLeg: TradeLeg = {
      side: "sell",
      exchange: opp.sellExchange,
      requestedSize: round8(size),
      filledSize: round8(sellFilled),
      avgPrice: round2(sellPrice),
      state: legState(rejectSell, size, opp.size),
    };

    const trade: SimulatedTrade = {
      id: randomUUID(),
      opportunityId: opp.id,
      symbol: opp.symbol,
      buyExchange: opp.buyExchange,
      sellExchange: opp.sellExchange,
      filledSize: round8(matched),
      requestedSize: round8(opp.size),
      avgBuyPrice: round2(buyPrice),
      avgSellPrice: round2(sellPrice),
      fees: round2(feesPaid),
      netProfit: round2(netProfit),
      partial: matched < size - 1e-8 || Math.abs(residual) > EPS,
      executedAt: Date.now(),
      buyLeg,
      sellLeg,
      residualBtc: residual,
      resolution,
      resolutionPnlUsd: round2(resolutionPnl),
      finalState: "flat",
      walletDeltas: walletDeltas.map((d) => ({
        exchange: d.exchange,
        usd: round2(d.usd),
        btc: round8(d.btc),
      })),
      scenarioTags,
    };
    return trade;
  }
}

/** Leg state: rejected (0 fill), partial (liquidity-capped), or fully filled. */
function legState(rejected: boolean, size: number, requested: number): OrderLegState {
  if (rejected) return "rejected";
  return size < requested - 1e-8 ? "partial" : "filled";
}

/** Shrink each level's quantity to simulate a liquidity crunch. */
function haircutLevels(levels: BookLevel[], haircut: number): BookLevel[] {
  const keep = 1 - haircut;
  return levels.map(([price, qty]) => [price, qty * keep] as const);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
