import type {
  EngineConfig,
  EquityPoint,
  ExchangeId,
  PortfolioStats,
  RebalanceEvent,
  SimulatedTrade,
  VenueInventory,
  WalletBalance,
} from "@arb/shared";

const MAX_CURVE_POINTS = 500;
/** Cap on the rebalance-event timeline surfaced to the wallets panel. */
const MAX_REBALANCE_EVENTS = 25;

/**
 * Tracks simulated wallet balances per exchange and derives P&L.
 *
 * Inventory model: buying BTC on exchange A debits A's USD and credits A's BTC;
 * selling on B debits B's BTC and credits B's USD. Balances drift over time
 * (A accumulates BTC, B accumulates USD), which is exactly why real desks must
 * rebalance — we surface that drift rather than hiding it behind a fiction of
 * per-trade on-chain transfers.
 */
export class Portfolio {
  private readonly wallets = new Map<ExchangeId, WalletBalance>();
  /** Baseline BTC per venue; drift from this triggers rebalancing. */
  private readonly baselineBtc = new Map<ExchangeId, number>();
  /**
   * Captured at the FIRST real mark price, not at boot. Benchmarking against a
   * placeholder price would revalue the pre-positioned BTC inventory and show a
   * phantom gain (e.g. +12% with zero trades) that has nothing to do with the
   * arbitrage strategy. Null until the first live price arrives.
   */
  private startingEquity: number | null = null;
  private realizedPnl = 0;
  private totalTrades = 0;
  private totalOpportunities = 0;
  private actionableOpportunities = 0;
  private winningTrades = 0;
  private rebalanceEvents = 0;
  private rebalanceCostUsd = 0;
  private readonly equityCurve: EquityPoint[] = [];
  /** Recent on-chain transfers (newest first) for the wallets timeline. */
  private readonly recentRebalances: RebalanceEvent[] = [];

  constructor(
    exchanges: ExchangeId[],
    startUsd: number,
    startBtc: number,
    referencePrice: number,
    /** Shared engine config (read by reference for live-tunable fees/threshold). */
    private readonly config: EngineConfig,
  ) {
    for (const ex of exchanges) {
      this.wallets.set(ex, { exchange: ex, usd: startUsd, btc: startBtc });
      this.baselineBtc.set(ex, startBtc);
    }
    // Only lock the baseline if a genuine price is already known at construction.
    if (referencePrice > 0) this.startingEquity = this.equity(referencePrice);
  }

  /**
   * Lock the starting-equity baseline at the first real mark price. No-op once
   * set, so equity honestly starts at a 0% gain rather than reflecting the gap
   * between a placeholder price and the live market.
   */
  ensureBaseline(referencePrice: number): void {
    if (this.startingEquity === null && referencePrice > 0) {
      this.startingEquity = this.equity(referencePrice);
    }
  }

  /** Max base size affordable given USD on buy side and BTC on sell side. */
  capacity(buy: ExchangeId, sell: ExchangeId, buyPrice: number): {
    maxByUsd: number;
    maxByBtc: number;
  } {
    const buyWallet = this.wallets.get(buy);
    const sellWallet = this.wallets.get(sell);
    return {
      maxByUsd: buyWallet ? buyWallet.usd / buyPrice : 0,
      maxByBtc: sellWallet ? sellWallet.btc : 0,
    };
  }

  applyTrade(trade: SimulatedTrade, referencePrice: number): void {
    // The simulator computes exact per-wallet balance deltas across BOTH legs
    // and any residual re-hedge/unwind, so we just apply them. This keeps the
    // accounting correct even when a leg is rejected and the position is
    // brought back to flat on a different venue than intended.
    for (const d of trade.walletDeltas) {
      const wallet = this.wallets.get(d.exchange);
      if (!wallet) continue;
      wallet.usd += d.usd;
      wallet.btc += d.btc;
    }

    this.realizedPnl += trade.netProfit;
    this.totalTrades += 1;
    if (trade.netProfit > 0) this.winningTrades += 1;

    this.rebalanceIfNeeded(referencePrice);
    this.pushEquity(referencePrice);
  }

  /**
   * Inventory rebalancing as an (s,S) policy with a deadband. Each venue has a
   * target BTC level (its starting baseline) and a deadband [target − band,
   * target + band], where `band = config.rebalanceThresholdBtc`. No action is
   * taken while BTC stays inside the band; when a venue's BTC crosses the
   * **ceiling** it ships the excess back down to the **target** (order-up-to S),
   * not just to the ceiling — so a tiny wiggle doesn't immediately re-trigger.
   * That gap between the trigger (s) and the return level (S) is exactly what
   * prevents thrashing.
   *
   * The excess goes to the most-depleted venue (which is simultaneously below
   * its own floor), so one transfer fixes both sides. We settle the USD leg
   * internally and book only the BTC network (withdrawal) fee — the ONLY place
   * withdrawal fees enter the model, amortized across trades, as in production.
   */
  private rebalanceIfNeeded(referencePrice: number): void {
    if (referencePrice <= 0) return;
    const band = this.config.rebalanceThresholdBtc;
    for (const wallet of this.wallets.values()) {
      if (wallet.exchange === "demo") continue;
      const target = this.baselineBtc.get(wallet.exchange) ?? 0;
      const ceiling = target + band;
      // Only the venue that breached its ceiling ships excess out.
      if (wallet.btc <= ceiling) continue;

      const dest = this.mostDepletedVenue(wallet.exchange);
      if (!dest) continue;

      const fee = this.config.fees[wallet.exchange].withdrawalFeeBtc;
      const amount = wallet.btc - target; // order back down to the target (S)
      const usdValue = amount * referencePrice;

      // On-chain BTC transfer (loses the network fee), USD settled internally.
      wallet.btc -= amount;
      dest.btc += amount - fee;
      dest.usd -= usdValue;
      wallet.usd += usdValue;

      const costUsd = fee * referencePrice;
      this.realizedPnl -= costUsd;
      this.rebalanceCostUsd += costUsd;
      this.rebalanceEvents += 1;
      this.recentRebalances.unshift({
        ts: Date.now(),
        fromExchange: wallet.exchange,
        toExchange: dest.exchange,
        amountBtc: round8(amount),
        costUsd: round(costUsd),
      });
      this.recentRebalances.length = Math.min(
        this.recentRebalances.length,
        MAX_REBALANCE_EVENTS,
      );
    }
  }

  /** The venue whose BTC has dropped furthest below its baseline. */
  private mostDepletedVenue(exclude: ExchangeId): WalletBalance | null {
    let worst: WalletBalance | null = null;
    let worstDrift = 0;
    for (const w of this.wallets.values()) {
      if (w.exchange === exclude || w.exchange === "demo") continue;
      const drift = w.btc - (this.baselineBtc.get(w.exchange) ?? 0);
      if (drift < worstDrift) {
        worstDrift = drift;
        worst = w;
      }
    }
    return worst;
  }

  recordOpportunity(actionable: boolean): void {
    this.totalOpportunities += 1;
    if (actionable) this.actionableOpportunities += 1;
  }

  private equity(referencePrice: number): number {
    let total = 0;
    for (const w of this.wallets.values()) total += w.usd + w.btc * referencePrice;
    return total;
  }

  private pushEquity(referencePrice: number): void {
    this.equityCurve.push({ t: Date.now(), equity: round(this.equity(referencePrice)) });
    if (this.equityCurve.length > MAX_CURVE_POINTS) this.equityCurve.shift();
  }

  /**
   * Per-venue (s,S) inventory state for the wallets panel: target, deadband
   * edges and how many more max-size trades each venue can support (bound by
   * USD to buy or BTC to sell, whichever runs out first).
   */
  private inventory(referencePrice: number): VenueInventory[] {
    const band = this.config.rebalanceThresholdBtc;
    const tradeSizeBtc =
      referencePrice > 0 ? this.config.maxNotionalUsd / referencePrice : 0;
    return [...this.wallets.values()]
      .filter((w) => w.exchange !== "demo")
      .map((w) => {
        const target = this.baselineBtc.get(w.exchange) ?? 0;
        const buyable = tradeSizeBtc > 0 ? w.usd / (referencePrice * tradeSizeBtc) : 0;
        const sellable = tradeSizeBtc > 0 ? w.btc / tradeSizeBtc : 0;
        return {
          exchange: w.exchange,
          usd: round(w.usd),
          btc: round8(w.btc),
          targetBtc: round8(target),
          floorBtc: round8(Math.max(0, target - band)),
          ceilingBtc: round8(target + band),
          capacityTrades: Math.max(0, Math.floor(Math.min(buyable, sellable))),
        };
      });
  }

  stats(referencePrice: number): PortfolioStats {
    const currentEquity = this.equity(referencePrice);
    // Before the first real price, report equity as its own baseline (0% gain).
    const baseline = this.startingEquity ?? currentEquity;
    return {
      startingEquityUsd: round(baseline),
      currentEquityUsd: round(currentEquity),
      realizedPnlUsd: round(this.realizedPnl),
      totalTrades: this.totalTrades,
      totalOpportunities: this.totalOpportunities,
      actionableOpportunities: this.actionableOpportunities,
      winRate: this.totalTrades > 0 ? this.winningTrades / this.totalTrades : 0,
      wallets: [...this.wallets.values()].map((w) => ({
        exchange: w.exchange,
        usd: round(w.usd),
        btc: round8(w.btc),
      })),
      inventory: this.inventory(referencePrice),
      equityCurve: this.equityCurve,
      rebalancing: {
        events: this.rebalanceEvents,
        totalCostUsd: round(this.rebalanceCostUsd),
        amortizedCostPerTradeUsd:
          this.totalTrades > 0 ? round(this.rebalanceCostUsd / this.totalTrades) : 0,
        bandBtc: round8(this.config.rebalanceThresholdBtc),
        recentEvents: this.recentRebalances,
      },
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
