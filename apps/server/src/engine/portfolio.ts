import type {
  EngineConfig,
  EquityPoint,
  ExchangeId,
  PortfolioStats,
  SimulatedTrade,
  WalletBalance,
} from "@arb/shared";

const MAX_CURVE_POINTS = 500;

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
    const buyWallet = this.wallets.get(trade.buyExchange);
    const sellWallet = this.wallets.get(trade.sellExchange);
    if (!buyWallet || !sellWallet) return;

    const buyFee = trade.fees / 2; // split is informational only
    buyWallet.usd -= trade.avgBuyPrice * trade.filledSize + buyFee;
    buyWallet.btc += trade.filledSize;

    sellWallet.btc -= trade.filledSize;
    sellWallet.usd += trade.avgSellPrice * trade.filledSize - (trade.fees - buyFee);

    this.realizedPnl += trade.netProfit;
    this.totalTrades += 1;
    if (trade.netProfit > 0) this.winningTrades += 1;

    this.rebalanceIfNeeded(referencePrice);
    this.pushEquity(referencePrice);
  }

  /**
   * Inventory model: the buy-venue keeps accumulating BTC while the sell-venue
   * depletes it. When a venue drifts past the threshold, a real desk moves BTC
   * on-chain to rebalance — paying that venue's BTC withdrawal fee. We move the
   * excess to the most-depleted venue, settle the USD leg internally, and book
   * only the network fee as a (real) cost. This is the ONLY place withdrawal
   * fees enter the model, exactly as in production: amortized, not per-trade.
   */
  private rebalanceIfNeeded(referencePrice: number): void {
    if (referencePrice <= 0) return;
    // Multiple venues can drift; settle each over-threshold accumulator.
    for (const wallet of this.wallets.values()) {
      if (wallet.exchange === "demo") continue;
      const baseline = this.baselineBtc.get(wallet.exchange) ?? 0;
      const drift = wallet.btc - baseline;
      if (drift <= this.config.rebalanceThresholdBtc) continue;

      const target = this.mostDepletedVenue(wallet.exchange);
      if (!target) continue;

      const fee = this.config.fees[wallet.exchange].withdrawalFeeBtc;
      const amount = drift; // send the excess back toward baseline
      const usdValue = amount * referencePrice;

      // On-chain BTC transfer (loses the network fee), USD settled internally.
      wallet.btc -= amount;
      target.btc += amount - fee;
      target.usd -= usdValue;
      wallet.usd += usdValue;

      const costUsd = fee * referencePrice;
      this.realizedPnl -= costUsd;
      this.rebalanceCostUsd += costUsd;
      this.rebalanceEvents += 1;
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
      equityCurve: this.equityCurve,
      rebalancing: {
        events: this.rebalanceEvents,
        totalCostUsd: round(this.rebalanceCostUsd),
        amortizedCostPerTradeUsd:
          this.totalTrades > 0 ? round(this.rebalanceCostUsd / this.totalTrades) : 0,
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
