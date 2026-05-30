import { Activity, BarChart3, FlaskConical, HelpCircle, Radio, Route } from "lucide-react";
import type { EngineConfig, FeedStatus, LatencyStats } from "@arb/shared";
import { Badge } from "@/components/ui/badge";
import { FilobotLogo } from "@/components/FilobotLogo";
import { ms, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

interface Props {
  connected: boolean;
  config: EngineConfig | null;
  feeds: FeedStatus[];
  latency: LatencyStats | null;
  onToggleDemo: (enabled: boolean) => void;
  onOpenGuide: () => void;
  onStartTour: () => void;
  onOpenStats: () => void;
}

export function StatusBar({
  connected,
  config,
  feeds,
  latency,
  onToggleDemo,
  onOpenGuide,
  onStartTour,
  onOpenStats,
}: Props) {
  const { lang, setLang, t } = useLang();
  const demoOn = config?.demoMode ?? false;
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/[0.06] bg-card/60 px-4 py-2.5 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 drop-shadow-[0_0_12px_hsl(var(--primary)/0.5)]">
          <FilobotLogo />
        </div>
        <div className="leading-tight">
          <div className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-sm font-bold uppercase tracking-[0.2em] text-transparent">
            Filobot
          </div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Cross-exchange BTC arbitrage engine
          </div>
        </div>
        {config && (
          <Badge variant="muted" className="ml-1">
            {config.symbol}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {connected && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-70" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              connected ? "bg-profit" : "bg-loss",
            )}
          />
        </span>
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

      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Processing p50/p95
          </span>
          <span className="text-sm font-semibold tabular-nums text-primary glow-primary">
            {ms(latency?.processing.p50 ?? null)} / {ms(latency?.processing.p95 ?? null)}
          </span>
        </div>

        <button
          id="tour-demo"
          type="button"
          onClick={() => onToggleDemo(!demoOn)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
            demoOn
              ? "border-warn/50 bg-warn/15 text-warn"
              : "border-border bg-muted text-muted-foreground hover:text-foreground",
          )}
          title="Toggle the clearly-labeled synthetic demo/replay injector"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          Demo {demoOn ? "ON" : "OFF"}
        </button>

        <button
          type="button"
          onClick={onOpenStats}
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          title={t("nav.stats")}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t("nav.stats")}
        </button>

        <button
          type="button"
          onClick={onStartTour}
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          title={t("nav.tour")}
        >
          <Route className="h-3.5 w-3.5" />
          {t("nav.tour")}
        </button>

        <button
          type="button"
          onClick={onOpenGuide}
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          title={t("nav.guide")}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          {t("nav.guide")}
        </button>

        <div className="flex items-center overflow-hidden rounded-md border border-border">
          {(["es", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={cn(
                "px-2 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                lang === code
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {code}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
