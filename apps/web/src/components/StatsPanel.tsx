import { X } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistogramBucket, StatsSnapshot } from "@arb/shared";
import { useLang } from "@/lib/i18n";
import { titleCase } from "@/lib/format";

interface Props {
  open: boolean;
  stats: StatsSnapshot | null;
  onClose: () => void;
}

export function StatsPanel({ open, stats, onClose }: Props) {
  const { t } = useLang();
  if (!open) return null;

  const hasData = stats != null && stats.sampleCount > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex-none px-6 pb-3 pt-6">
          <h2 className="text-lg font-bold uppercase tracking-widest">
            {t("stats.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("stats.subtitle")}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
          {!hasData ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("stats.empty")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Tile
                  label={t("stats.detRate")}
                  value={stats.opportunities.perMinute.toLocaleString("en-US")}
                />
                <Tile
                  label={t("stats.actRate")}
                  value={`${stats.opportunities.actionableRatePct}%`}
                  tone={stats.opportunities.actionableRatePct > 0 ? "profit" : "default"}
                />
                <Tile label={t("stats.medGross")} value={`${stats.grossBps.p50} bps`} />
                <Tile
                  label={t("stats.medNet")}
                  value={`${stats.netBps.p50} bps`}
                  tone={stats.netBps.p50 >= 0 ? "profit" : "loss"}
                />
                <Tile
                  label={t("stats.meanSurvival")}
                  value={`${Math.round(stats.meanSurvival * 100)}%`}
                />
              </div>

              <Histogram
                title={t("stats.grossHist")}
                data={stats.grossBps.histogram}
                colorFor={() => "hsl(var(--primary))"}
              />
              <Histogram
                title={t("stats.netHist")}
                data={stats.netBps.histogram}
                colorFor={(b) =>
                  (b.from < 0 ? "hsl(var(--loss))" : "hsl(var(--profit))")
                }
              />

              <VenueActivity stats={stats} t={t} />

              <p className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
                {t("stats.takeaway")}
              </p>

              <div className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {t("stats.sample")}: {stats.sampleCount.toLocaleString("en-US")}{" "}
                {t("stats.crosses")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss" | "default";
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "mt-1 text-base font-bold tabular-nums " +
          (tone === "profit"
            ? "text-profit"
            : tone === "loss"
              ? "text-loss"
              : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Histogram({
  title,
  data,
  colorFor,
}: {
  title: string;
  data: HistogramBucket[];
  colorFor: (b: HistogramBucket) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            stroke="hsl(var(--border))"
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            stroke="hsl(var(--border))"
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {data.map((b, i) => (
              <Cell key={i} fill={colorFor(b)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VenueActivity({
  stats,
  t,
}: {
  stats: StatsSnapshot;
  t: (k: "stats.venues" | "stats.asBuy" | "stats.asSell") => string;
}) {
  const max = Math.max(1, ...stats.venues.map((v) => v.asBuy + v.asSell));
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {t("stats.venues")}
      </div>
      <div className="space-y-1.5">
        {stats.venues.map((v) => (
          <div key={v.exchange} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 flex-none text-muted-foreground">
              {titleCase(v.exchange)}
            </span>
            <div className="flex h-3 flex-1 overflow-hidden rounded-sm bg-muted/30">
              <div
                className="h-full bg-profit/70"
                style={{ width: `${(v.asBuy / max) * 100}%` }}
                title={`${t("stats.asBuy")}: ${v.asBuy}`}
              />
              <div
                className="h-full bg-loss/70"
                style={{ width: `${(v.asSell / max) * 100}%` }}
                title={`${t("stats.asSell")}: ${v.asSell}`}
              />
            </div>
            <span className="w-24 flex-none text-right tabular-nums text-muted-foreground">
              <span className="text-profit">{v.asBuy}</span>
              {" / "}
              <span className="text-loss">{v.asSell}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
