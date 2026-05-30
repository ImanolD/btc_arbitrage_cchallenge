import type { PortfolioStats } from "@arb/shared";
import { Card, CardContent } from "@/components/ui/card";
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  portfolio: PortfolioStats | null;
}

export function StatCards({ portfolio }: Props) {
  const pnl = portfolio?.realizedPnlUsd ?? 0;
  const equity = portfolio?.currentEquityUsd ?? 0;
  const startEquity = portfolio?.startingEquityUsd ?? 0;
  const equityDelta = equity - startEquity;

  const items: {
    label: string;
    value: string;
    tone?: "profit" | "loss" | "default";
  }[] = [
    {
      label: "Realized P&L",
      value: usd(pnl),
      tone: pnl > 0 ? "profit" : pnl < 0 ? "loss" : "default",
    },
    {
      label: "Equity (mark-to-market)",
      value: usd(equity),
      tone: equityDelta >= 0 ? "profit" : "loss",
    },
    { label: "Trades executed", value: String(portfolio?.totalTrades ?? 0) },
    {
      label: "Opportunities (actionable)",
      value: `${portfolio?.totalOpportunities ?? 0} (${portfolio?.actionableOpportunities ?? 0})`,
    },
    {
      label: "Win rate",
      value: portfolio ? pct(portfolio.winRate, 1) : "—",
      tone: "default",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.label}
            </div>
            <div
              className={cn(
                "mt-1 text-lg font-bold tabular-nums",
                item.tone === "profit" && "text-profit",
                item.tone === "loss" && "text-loss",
              )}
            >
              {item.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
