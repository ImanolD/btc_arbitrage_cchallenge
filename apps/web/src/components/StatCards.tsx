import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Gauge,
  Percent,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { PortfolioStats } from "@arb/shared";
import { Card, CardContent } from "@/components/ui/card";
import { InfoButton } from "@/components/InfoButton";
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StringKey } from "@/lib/i18n";

interface Props {
  portfolio: PortfolioStats | null;
  /** Epoch ms the server booted; used for the "live since · uptime" label. */
  startedAt?: number;
}

/** Compact uptime, e.g. "3d 4h", "5h 12m", or "8m". */
function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type Tone = "profit" | "loss" | "default";

interface Item {
  label: string;
  value: string;
  icon: LucideIcon;
  info: string;
  tone?: Tone;
  sub?: string;
  title?: string;
}

export function StatCards({ portfolio, startedAt }: Props) {
  const pnl = portfolio?.realizedPnlUsd ?? 0;
  const equity = portfolio?.currentEquityUsd ?? 0;
  const startEquity = portfolio?.startingEquityUsd ?? 0;
  const equityDelta = equity - startEquity;
  const equityDeltaPct = startEquity ? equityDelta / startEquity : 0;

  // Tick once a minute so the uptime label stays current without churn.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const uptime = startedAt ? formatUptime(now - startedAt) : null;
  const liveSince = startedAt
    ? `Live since ${new Date(startedAt).toLocaleString()}`
    : undefined;

  const items: Item[] = [
    {
      label: "Realized P&L",
      value: usd(pnl),
      icon: Coins,
      info: "pnl",
      tone: pnl > 0 ? "profit" : pnl < 0 ? "loss" : "default",
      sub: portfolio ? `${portfolio.totalTrades} fills` : undefined,
    },
    {
      label: "Equity · mark-to-market",
      value: usd(equity),
      icon: Wallet,
      info: "equity",
      tone: equityDelta > 0 ? "profit" : equityDelta < 0 ? "loss" : "default",
      sub:
        portfolio && startEquity
          ? `${equityDelta >= 0 ? "+" : ""}${usd(equityDelta)} (${equityDelta >= 0 ? "+" : ""}${pct(equityDeltaPct, 2)})`
          : undefined,
    },
    {
      label: "Trades executed",
      value: String(portfolio?.totalTrades ?? 0),
      icon: Activity,
      info: "trades",
    },
    {
      label: "Opportunities",
      value: String(portfolio?.totalOpportunities ?? 0),
      icon: Gauge,
      info: "opps",
      sub: `${portfolio?.actionableOpportunities ?? 0} actionable${uptime ? ` · live ${uptime}` : ""}`,
      title: liveSince,
    },
    {
      label: "Win rate",
      value: portfolio ? pct(portfolio.winRate, 1) : "—",
      icon: Percent,
      info: "winrate",
    },
    {
      label: "Rebalance cost / trade",
      value: portfolio
        ? usd(portfolio.rebalancing.amortizedCostPerTradeUsd)
        : "—",
      icon: Coins,
      info: "rebalance",
      sub: portfolio ? `${portfolio.rebalancing.events} rebalances` : undefined,
      title: portfolio
        ? `${portfolio.rebalancing.events} on-chain rebalances · ${usd(
            portfolio.rebalancing.totalCostUsd,
          )} total withdrawal fees`
        : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => {
        const tone = item.tone ?? "default";
        const Icon = item.icon;
        return (
          <Card key={item.label} title={item.title} className="relative overflow-hidden">
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-[3px]",
                tone === "profit" && "bg-profit",
                tone === "loss" && "bg-loss",
                tone === "default" && "bg-primary/40",
              )}
            />
            <CardContent className="p-3 pl-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Icon className="h-3 w-3 text-muted-foreground/60" />
                  {item.label}
                </span>
                <InfoButton
                  titleKey={`info.${item.info}.title` as StringKey}
                  bodyKey={`info.${item.info}.body` as StringKey}
                />
              </div>
              <div
                className={cn(
                  "mt-1.5 flex items-center gap-1 text-xl font-bold tabular-nums",
                  tone === "profit" && "text-profit glow-profit",
                  tone === "loss" && "text-loss glow-loss",
                )}
              >
                {tone === "profit" && <ArrowUpRight className="h-4 w-4 flex-none" />}
                {tone === "loss" && <ArrowDownRight className="h-4 w-4 flex-none" />}
                {item.value}
              </div>
              {item.sub && (
                <div
                  className={cn(
                    "mt-0.5 text-[10px] tabular-nums",
                    tone === "profit"
                      ? "text-profit/80"
                      : tone === "loss"
                        ? "text-loss/80"
                        : "text-muted-foreground",
                  )}
                >
                  {item.sub}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
