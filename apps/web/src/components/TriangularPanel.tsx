import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { EngineConfig, TriangularOpportunity } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pct, titleCase, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  triangular: TriangularOpportunity[];
  config: EngineConfig | null;
}

export function TriangularPanel({ triangular, config }: Props) {
  const latest = useMemo(() => {
    const fwd = triangular.find((t) => t.direction === "forward");
    const rev = triangular.find((t) => t.direction === "reverse");
    return { fwd, rev };
  }, [triangular]);

  const venue = config?.triangular?.exchange;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          Triangular arbitrage{venue ? ` — ${titleCase(venue)}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Cycle opp={latest.fwd} label="USDT → BTC → ETH → USDT" />
        <Cycle opp={latest.rev} label="USDT → ETH → BTC → USDT" />
        <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
          Single-venue loop across BTC/USDT · ETH/BTC · ETH/USDT, net of three
          taker fees on a {config?.triangular ? usd(config.triangular.notionalUsd, 0) : "—"} notional.
        </p>
      </CardContent>
    </Card>
  );
}

function Cycle({
  opp,
  label,
}: {
  opp: TriangularOpportunity | undefined;
  label: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        {opp ? (
          opp.actionable ? (
            <Badge variant="profit">EXEC</Badge>
          ) : (
            <Badge variant="muted" title={opp.reason}>
              SKIP
            </Badge>
          )
        ) : (
          <Badge variant="muted">—</Badge>
        )}
      </div>

      {opp && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]">
          {opp.path.map((asset, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="font-medium">{asset}</span>
              {i < opp.path.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              )}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Net / loop
        </span>
        <span
          className={cn(
            "text-sm font-bold tabular-nums",
            !opp ? "text-muted-foreground" : opp.netProfit > 0 ? "text-profit" : "text-loss",
          )}
        >
          {opp ? `${usd(opp.netProfit)} (${pct(opp.netProfitPct, 3)})` : "—"}
        </span>
      </div>
    </div>
  );
}
