import type { ExchangeId, LatencyStats } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { InfoButton } from "@/components/InfoButton";
import { ms, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  latency: LatencyStats | null;
}

export function LatencyPanel({ latency }: Props) {
  const feedAges = Object.entries(latency?.feedAgeMs ?? {}) as [
    ExchangeId,
    number,
  ][];

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Latency</CardTitle>
          <InfoButton titleKey="info.latency.title" bodyKey="info.latency.body" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Metric
          label="Processing (t2 − t1)"
          p50={latency?.processing.p50}
          p95={latency?.processing.p95}
          p99={latency?.processing.p99}
          accent
        />
        <Separator />
        <Metric
          label="Feed (t1 − t0)"
          p50={latency?.feed.p50}
          p95={latency?.feed.p95}
          p99={latency?.feed.p99}
        />
        <Separator />
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Feed freshness
          </div>
          <div className="space-y-1">
            {feedAges.length === 0 && (
              <div className="text-muted-foreground">—</div>
            )}
            {feedAges.map(([ex, age]) => (
              <div key={ex} className="flex items-center justify-between">
                <span className="text-muted-foreground">{titleCase(ex)}</span>
                <span
                  className={cn(
                    "tabular-nums",
                    age < 1000 ? "text-profit" : age < 3000 ? "text-warn" : "text-loss",
                  )}
                >
                  {age}ms ago
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  p50,
  p95,
  p99,
  accent,
}: {
  label: string;
  p50?: number;
  p95?: number;
  p99?: number;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["p50", p50],
            ["p95", p95],
            ["p99", p99],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-md bg-muted/40 py-1.5">
            <div className="text-[9px] uppercase text-muted-foreground">{k}</div>
            <div
              className={cn(
                "text-sm font-bold tabular-nums",
                accent ? "text-primary" : "text-foreground",
              )}
            >
              {ms(v ?? null)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
