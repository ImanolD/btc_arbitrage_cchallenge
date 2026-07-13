import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortfolioStats } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoButton } from "@/components/InfoButton";
import { HonestEmpty } from "@/components/HonestEmpty";
import { time, usd } from "@/lib/format";

interface Props {
  portfolio: PortfolioStats | null;
  demoOn: boolean;
  onEnableDemo: () => void;
}

export function EquityChart({ portfolio, demoOn, onEnableDemo }: Props) {
  const data = (portfolio?.equityCurve ?? []).map((p) => ({
    t: p.t,
    equity: p.equity,
  }));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Equity curve (mark-to-market)</CardTitle>
          <InfoButton
            titleKey="info.equitycurve.title"
            bodyKey="info.equitycurve.body"
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length < 2 ? (
          <HonestEmpty demoOn={demoOn} onEnableDemo={onEnableDemo} />
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={160}>
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--profit))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--profit))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tickFormatter={time}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                stroke="hsl(var(--border))"
                minTickGap={48}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                stroke="hsl(var(--border))"
                width={70}
                tickFormatter={(v) => usd(Number(v), 0)}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(t) => time(Number(t))}
                formatter={(v) => [usd(Number(v)), "Equity"]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="hsl(var(--profit))"
                strokeWidth={2}
                fill="url(#eq)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
