import { ScanLine } from "lucide-react";
import type { StatsSnapshot } from "@arb/shared";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Always-true "hero insight" strip: even with 0 trades and a flat equity curve,
 * the empirical population of analyzed crosses tells the real story — the median
 * net spread is negative, so almost nothing is actionable. That IS the finding
 * (market efficiency), and it's our intellectual edge. Data comes from the
 * server-side aggregator over the FULL cross population, not the client buffer.
 */
export function HeroInsight({ stats }: { stats: StatsSnapshot | null }) {
  const { t } = useLang();
  if (!stats || stats.sampleCount <= 0) return null;

  const analyzed = stats.sampleCount.toLocaleString();
  const netP50 = stats.netBps.p50;
  const rate = stats.opportunities.actionableRatePct;
  const netStr = `${netP50 >= 0 ? "+" : ""}${netP50.toFixed(1)} bps`;
  const rateStr = `${rate.toFixed(rate > 0 && rate < 1 ? 2 : 1)}%`;

  return (
    <div
      id="tour-hero"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/30 bg-gradient-to-r from-primary/10 to-transparent px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-primary">
        <ScanLine className="h-3.5 w-3.5" />
        {t("hero.label")}
      </span>
      <span className="text-muted-foreground/50">·</span>
      <span className="font-semibold tabular-nums text-foreground">{analyzed}</span>
      <span className="text-muted-foreground">{t("hero.analyzed")}</span>
      <span className="text-muted-foreground/50">·</span>
      <span className="text-muted-foreground">{t("hero.medianNet")}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          netP50 < 0 ? "text-loss" : "text-profit",
        )}
      >
        {netStr}
      </span>
      <span className="text-muted-foreground/50">·</span>
      <span className="font-semibold tabular-nums text-foreground">{rateStr}</span>
      <span className="text-muted-foreground">{t("hero.actionable")}</span>
      <span className="hidden text-muted-foreground sm:inline">
        — {t("hero.thesis")}
      </span>
    </div>
  );
}
