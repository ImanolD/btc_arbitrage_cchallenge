import { Activity, Radio, Zap } from "lucide-react";
import type { EngineConfig, FeedStatus, LatencyStats } from "@arb/shared";
import { Badge } from "@/components/ui/badge";
import { ms, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  connected: boolean;
  config: EngineConfig | null;
  feeds: FeedStatus[];
  latency: LatencyStats | null;
}

export function StatusBar({ connected, config, feeds, latency }: Props) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-primary" />
        <span className="text-sm font-bold uppercase tracking-widest">
          BTC Arbitrage Terminal
        </span>
        {config && (
          <Badge variant="muted" className="ml-1">
            {config.symbol}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            connected ? "bg-profit animate-pulse" : "bg-loss",
          )}
        />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {feeds.map((feed) => (
          <div key={feed.exchange} className="flex items-center gap-1.5">
            <Radio
              className={cn(
                "h-3.5 w-3.5",
                feed.status === "connected"
                  ? "text-profit"
                  : feed.status === "connecting"
                    ? "text-warn"
                    : "text-loss",
              )}
            />
            <span className="text-[11px] text-muted-foreground">
              {titleCase(feed.exchange)}
            </span>
          </div>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Processing p50/p95
        </span>
        <span className="text-sm font-semibold tabular-nums text-primary">
          {ms(latency?.processing.p50 ?? null)} / {ms(latency?.processing.p95 ?? null)}
        </span>
      </div>
    </header>
  );
}
