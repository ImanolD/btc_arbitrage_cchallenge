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
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  portfolio: PortfolioStats | null;
}

type Tone = "profit" | "loss" | "default";

interface Item {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: Tone;
  sub?: string;
  title?: string;
}

export function StatCards({ portfolio }: Props) {
  const pnl = portfolio?.realizedPnlUsd ?? 0;
  const equity = portfolio?.currentEquityUsd ?? 0;
  const startEquity = portfolio?.startingEquityUsd ?? 0;
  const equityDelta = equity - startEquity;
  const equityDeltaPct = startEquity ? equityDelta / startEquity : 0;

  const items: Item[] = [
    {
      label: "Realized P&L",
      value: usd(pnl),
      icon: Coins,
      tone: pnl > 0 ? "profit" : pnl < 0 ? "loss" : "default",
      sub: portfolio ? `${portfolio.totalTrades} fills` : undefined,
    },
    {
      label: "Equity · mark-to-market",
      value: usd(equity),
      icon: Wallet,
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
    },
    {
      label: "Opportunities",
      value: String(portfolio?.totalOpportunities ?? 0),
      icon: Gauge,
      sub: `${portfolio?.actionableOpportunities ?? 0} actionable`,
    },
    {
      label: "Win rate",
      value: portfolio ? pct(portfolio.winRate, 1) : "—",
      icon: Percent,
    },
    {
      label: "Rebalance cost / trade",
      value: portfolio
        ? usd(portfolio.rebalancing.amortizedCostPerTradeUsd)
        : "—",
      icon: Coins,
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
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {item.label}
                </span>
                <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
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
