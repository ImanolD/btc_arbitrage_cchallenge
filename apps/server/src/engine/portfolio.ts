import type {
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
  private readonly startingEquity: number;
  private realizedPnl = 0;
  private totalTrades = 0;
  private totalOpportunities = 0;
  private actionableOpportunities = 0;
  private winningTrades = 0;
  private readonly equityCurve: EquityPoint[] = [];

  constructor(
    exchanges: ExchangeId[],
    startUsd: number,
    startBtc: number,
    referencePrice: number,
  ) {
    for (const ex of exchanges) {
      this.wallets.set(ex, { exchange: ex, usd: startUsd, btc: startBtc });
    }
    this.startingEquity = this.equity(referencePrice);
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

    this.pushEquity(referencePrice);
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
    return {
      startingEquityUsd: round(this.startingEquity),
      currentEquityUsd: round(this.equity(referencePrice)),
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
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
