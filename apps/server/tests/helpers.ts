import type {
  EngineConfig,
  ExchangeId,
  Opportunity,
  SimulatedTrade,
  TopOfBook,
  TradeLeg,
  WalletDelta,
} from "@arb/shared";
import { feeModels } from "../src/config.js";

/** A full EngineConfig for tests, with deep-cloned fees/scenario so a test that
 *  mutates them can never leak into another test. */
export function makeConfig(over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    symbol: "BTCUSDT",
    startedAt: Date.now(),
    exchanges: ["binance", "kraken"],
    maxNotionalUsd: 50_000,
    minNetProfitUsd: 1,
    maxSaneSpreadPct: 0.05,
    maxQuoteAgeMs: 2_000,
    maxVenueDeviationPct: 0.01,
    demoMode: false,
    triangular: [],
    ev: { tauMs: 400, adverseBps: 5, minEvUsd: 0 },
    decisionMode: "ev",
    filo: { digestMs: 0, narrate: false },
    rebalanceThresholdBtc: 0.5,
    fees: structuredClone(feeModels),
    disabledExchanges: [],
    scenario: { rejectProb: 0, liquidityHaircutPct: 0, priceGapBps: 0 },
    ...over,
  };
}

/** Minimal top-of-book with a single depth level (enough for unit tests). */
export function makeBook(
  exchange: ExchangeId,
  bestBid: number,
  bestAsk: number,
  qty = 5,
): TopOfBook {
  return {
    exchange,
    symbol: "BTCUSDT",
    quote: "USDT",
    bids: [[bestBid, qty]],
    asks: [[bestAsk, qty]],
    bestBid,
    bestAsk,
    exchangeTime: Date.now(),
    receivedAt: Date.now(),
  };
}

export function makeOpp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    symbol: "BTCUSDT",
    buyExchange: "binance",
    sellExchange: "kraken",
    buyPrice: 100_000,
    sellPrice: 100_500,
    size: 1,
    grossProfit: 500,
    netProfit: 300,
    netProfitPct: 0.003,
    survivalProb: 0.9,
    expectedValueUsd: 250,
    actionable: true,
    latency: {} as Opportunity["latency"],
    detectedAt: Date.now(),
    ...over,
  };
}

function leg(
  side: "buy" | "sell",
  exchange: ExchangeId,
  size: number,
  price: number,
): TradeLeg {
  return {
    side,
    exchange,
    requestedSize: size,
    filledSize: size,
    avgPrice: price,
    state: "filled",
  };
}

/** A booked trade carrying explicit wallet deltas (what Portfolio.applyTrade
 *  consumes). Used to drive rebalancing without the full simulator. */
export function makeTrade(walletDeltas: WalletDelta[], netProfit = 10): SimulatedTrade {
  return {
    id: "trade-1",
    opportunityId: "opp-1",
    symbol: "BTCUSDT",
    buyExchange: "binance",
    sellExchange: "kraken",
    filledSize: 1,
    requestedSize: 1,
    avgBuyPrice: 100_000,
    avgSellPrice: 100_500,
    fees: 0,
    netProfit,
    partial: false,
    executedAt: Date.now(),
    buyLeg: leg("buy", "binance", 1, 100_000),
    sellLeg: leg("sell", "kraken", 1, 100_500),
    residualBtc: 0,
    resolution: "none",
    resolutionPnlUsd: 0,
    finalState: "flat",
    walletDeltas,
    scenarioTags: [],
  };
}

/** Replace Math.random with a fixed queue for deterministic scenario tests.
 *  Returns a restore function. Values are consumed in order; when exhausted it
 *  falls back to the real Math.random. */
export function stubRandom(sequence: number[]): () => void {
  const original = Math.random;
  let i = 0;
  Math.random = () => (i < sequence.length ? sequence[i++] : original());
  return () => {
    Math.random = original;
  };
}
