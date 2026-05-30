import { useMemo } from "react";
import { Crosshair } from "lucide-react";
import type { Opportunity } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { InfoButton } from "@/components/InfoButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ms, pct, time, titleCase, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  opportunities: Opportunity[];
}

// Cap the rendered rows: the feed is a firehose, and an unbounded list both
// drowns the rest of the dashboard and hurts render performance.
const MAX_ROWS = 18;

export function OpportunityFeed({ opportunities }: Props) {
  // Prioritization, made visible: the most net-profitable executable route in
  // the current window — the one the engine allocates capital to first.
  const { best, actionableCount } = useMemo(() => {
    let top: Opportunity | null = null;
    let count = 0;
    for (const o of opportunities) {
      if (!o.actionable) continue;
      count += 1;
      if (top === null || o.netProfit > top.netProfit) top = o;
    }
    return { best: top, actionableCount: count };
  }, [opportunities]);

  const visible = opportunities.slice(0, MAX_ROWS);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            Opportunity feed
            <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
              gross → net → EV
            </span>
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="muted">{opportunities.length} seen</Badge>
            <Badge variant={actionableCount > 0 ? "profit" : "muted"}>
              {actionableCount} exec
            </Badge>
            <InfoButton titleKey="info.feed.title" bodyKey="info.feed.body" />
          </div>
        </div>
        {best && (
          <div className="flex items-center justify-between rounded-md border border-profit/40 bg-gradient-to-r from-profit/15 to-transparent px-3 py-2">
            <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Badge variant="profit">TOP</Badge>
              Best executable · {titleCase(best.buyExchange)} →{" "}
              {titleCase(best.sellExchange)}
            </span>
            <span className="flex items-center gap-3 tabular-nums">
              <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                P(surv) {pct(best.survivalProb, 0)} · EV
              </span>
              <span className="text-sm font-bold text-profit glow-profit">
                {usd(best.expectedValueUsd)}
              </span>
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">P(surv)</TableHead>
                <TableHead className="text-right">EV</TableHead>
                <TableHead className="text-right">Proc.</TableHead>
                <TableHead className="text-right">Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No crosses detected yet. Real BTC arbs are rare — that's expected.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((opp) => (
                <TableRow
                  key={opp.id}
                  className={cn(
                    opp.actionable
                      ? "animate-flash-green bg-profit/[0.05]"
                      : "opacity-55 hover:opacity-100",
                  )}
                >
                  <TableCell className="text-muted-foreground">{time(opp.detectedAt)}</TableCell>
                  <TableCell className={cn(opp.actionable && "font-medium")}>
                    {titleCase(opp.buyExchange)} → {titleCase(opp.sellExchange)}
                  </TableCell>
                  <TableCell className="text-right text-[11px] text-muted-foreground">
                    {usd(opp.grossProfit)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-semibold",
                      opp.netProfit > 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {usd(opp.netProfit)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {pct(opp.survivalProb, 0)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-semibold tabular-nums",
                      opp.expectedValueUsd > 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {usd(opp.expectedValueUsd)}
                  </TableCell>
                  <TableCell className="text-right text-primary">
                    {ms(opp.latency.processingMs)}
                  </TableCell>
                  <TableCell className="text-right">
                    {opp.actionable ? (
                      <Badge variant="profit">EXEC</Badge>
                    ) : (
                      <Badge variant="muted" title={opp.reason}>
                        SKIP
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
