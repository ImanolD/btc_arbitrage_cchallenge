import type {
  ExchangeId,
  HistogramBucket,
  StatsSnapshot,
  VenueActivity,
} from "@arb/shared";

interface Sample {
  grossProfit: number;
  netProfit: number;
  cost: number;
  survival: number;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  actionable: boolean;
}

/** Percentile window cap — bounded memory; representative of recent population. */
const WINDOW = 3000;

// Fixed bucket edges (in bps). `null` upper edge = open-ended top bucket.
const GROSS_EDGES: Array<[number, number | null]> = [
  [0, 1],
  [1, 2],
  [2, 5],
  [5, 10],
  [10, 20],
  [20, 50],
  [50, null],
];
const NET_EDGES: Array<[number, number | null]> = [
  [-Infinity, -20],
  [-20, -10],
  [-10, -5],
  [-5, 0],
  [0, 5],
  [5, 10],
  [10, null],
];

/**
 * Computes empirical statistics over the FULL population of detected crosses.
 * Histograms and counters are exact (O(1) memory each); percentiles use a
 * bounded recent window. This is "real data computed", not a static narrative.
 */
export class StatsAggregator {
  private readonly bootAt = Date.now();
  private count = 0;
  private actionable = 0;

  private grossSum = 0;
  private grossMax = 0;
  private netSum = 0;
  private netMin = 0;
  private netMax = 0;
  private survivalSum = 0;

  private readonly grossWindow: number[] = [];
  private readonly netWindow: number[] = [];
  private readonly grossHist = GROSS_EDGES.map(() => 0);
  private readonly netHist = NET_EDGES.map(() => 0);
  private readonly asBuy = new Map<ExchangeId, number>();
  private readonly asSell = new Map<ExchangeId, number>();

  record(s: Sample): void {
    if (s.cost <= 0) return;
    const grossBps = (s.grossProfit / s.cost) * 10_000;
    const netBps = (s.netProfit / s.cost) * 10_000;

    this.count += 1;
    if (s.actionable) this.actionable += 1;

    this.grossSum += grossBps;
    this.grossMax = Math.max(this.grossMax, grossBps);
    this.netSum += netBps;
    this.netMin = this.count === 1 ? netBps : Math.min(this.netMin, netBps);
    this.netMax = this.count === 1 ? netBps : Math.max(this.netMax, netBps);
    this.survivalSum += s.survival;

    pushCapped(this.grossWindow, grossBps);
    pushCapped(this.netWindow, netBps);
    this.grossHist[binIndex(GROSS_EDGES, grossBps)] += 1;
    this.netHist[binIndex(NET_EDGES, netBps)] += 1;

    this.asBuy.set(s.buyExchange, (this.asBuy.get(s.buyExchange) ?? 0) + 1);
    this.asSell.set(s.sellExchange, (this.asSell.get(s.sellExchange) ?? 0) + 1);
  }

  snapshot(): StatsSnapshot {
    const uptimeSec = Math.max(1, (Date.now() - this.bootAt) / 1000);
    const n = Math.max(1, this.count);

    const venueIds = new Set<ExchangeId>([
      ...this.asBuy.keys(),
      ...this.asSell.keys(),
    ]);
    const venues: VenueActivity[] = [...venueIds]
      .map((exchange) => ({
        exchange,
        asBuy: this.asBuy.get(exchange) ?? 0,
        asSell: this.asSell.get(exchange) ?? 0,
      }))
      .sort((a, b) => b.asBuy + b.asSell - (a.asBuy + a.asSell));

    return {
      generatedAt: Date.now(),
      sampleCount: this.count,
      uptimeSec: round(uptimeSec),
      opportunities: {
        total: this.count,
        actionable: this.actionable,
        actionableRatePct: round((this.actionable / n) * 100),
        perMinute: round((this.count / uptimeSec) * 60),
      },
      grossBps: {
        mean: round(this.grossSum / n),
        p50: round(percentile(this.grossWindow, 50)),
        p95: round(percentile(this.grossWindow, 95)),
        max: round(this.grossMax),
        histogram: toBuckets(GROSS_EDGES, this.grossHist, "bps"),
      },
      netBps: {
        mean: round(this.netSum / n),
        p50: round(percentile(this.netWindow, 50)),
        p95: round(percentile(this.netWindow, 95)),
        min: round(this.netMin),
        max: round(this.netMax),
        histogram: toBuckets(NET_EDGES, this.netHist, "bps"),
      },
      meanSurvival: Math.round((this.survivalSum / n) * 1e4) / 1e4,
      venues,
    };
  }
}

function pushCapped(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}

function binIndex(edges: Array<[number, number | null]>, v: number): number {
  for (let i = 0; i < edges.length; i += 1) {
    const [, to] = edges[i];
    if (to === null || v < to) return i;
  }
  return edges.length - 1;
}

function toBuckets(
  edges: Array<[number, number | null]>,
  counts: number[],
  unit: string,
): HistogramBucket[] {
  return edges.map(([from, to], i) => ({
    from,
    to,
    label: label(from, to, unit),
    count: counts[i],
  }));
}

function label(from: number, to: number | null, unit: string): string {
  if (from === -Infinity) return `<${to} ${unit}`;
  if (to === null) return `${from}+ ${unit}`;
  return `${from}–${to} ${unit}`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
