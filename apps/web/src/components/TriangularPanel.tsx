import { useMemo } from "react";
import type { EngineConfig, ExchangeId, TriangularOpportunity } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { pct, titleCase, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  triangular: TriangularOpportunity[];
  config: EngineConfig | null;
}

interface VenueCycles {
  exchange: ExchangeId;
  fwd?: TriangularOpportunity;
  rev?: TriangularOpportunity;
}

export function TriangularPanel({ triangular, config }: Props) {
  const venues = useMemo<VenueCycles[]>(() => {
    const order = (config?.triangular ?? []).map((t) => t.exchange);
    const byVenue = new Map<ExchangeId, VenueCycles>();
    const ensure = (ex: ExchangeId) => {
      let v = byVenue.get(ex);
      if (!v) {
        v = { exchange: ex };
        byVenue.set(ex, v);
      }
      return v;
    };
    // `triangular` is newest-first; keep the first cycle seen per direction.
    for (const ex of order) ensure(ex);
    for (const opp of triangular) {
      const v = ensure(opp.exchange);
      if (opp.direction === "forward" && !v.fwd) v.fwd = opp;
      if (opp.direction === "reverse" && !v.rev) v.rev = opp;
    }
    const ordered = order.length ? order : [...byVenue.keys()];
    return ordered.map((ex) => byVenue.get(ex)!).filter(Boolean);
  }, [triangular, config]);

  const notional = config?.triangular?.[0]?.notionalUsd;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>
          Triangular arbitrage
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {venues.length} venue{venues.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Venue</span>
          <span className="text-right">USDT→BTC→ETH</span>
          <span className="text-right">USDT→ETH→BTC</span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1.5 pr-2">
            {venues.length === 0 && (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                Waiting for triangular feeds…
              </p>
            )}
            {venues.map((v) => (
              <VenueRow key={v.exchange} venue={v} />
            ))}
          </div>
        </ScrollArea>
        <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
          Per-venue loop across BTC/USDT · ETH/BTC · ETH/USDT, net of three taker
          fees on a {notional ? usd(notional, 0) : "—"} notional.
        </p>
      </CardContent>
    </Card>
  );
}

function VenueRow({ venue }: { venue: VenueCycles }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md border border-border bg-muted/20 px-2 py-1.5">
      <span className="text-xs font-medium">{titleCase(venue.exchange)}</span>
      <CycleCell opp={venue.fwd} />
      <CycleCell opp={venue.rev} />
    </div>
  );
}

function CycleCell({ opp }: { opp: TriangularOpportunity | undefined }) {
  if (!opp) {
    return <span className="text-right text-xs text-muted-foreground tabular-nums">—</span>;
  }
  return (
    <div className="flex items-center justify-end gap-1.5">
      {opp.actionable ? (
        <Badge variant="profit">EXEC</Badge>
      ) : (
        <Badge variant="muted" title={opp.reason}>
          SKIP
        </Badge>
      )}
      <span
        className={cn(
          "w-24 text-right text-xs font-semibold tabular-nums",
          opp.netProfit > 0 ? "text-profit" : "text-loss",
        )}
      >
        {usd(opp.netProfit)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          {pct(opp.netProfitPct, 3)}
        </span>
      </span>
    </div>
  );
}
