import { type ReactNode, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import type { SimulatedTrade, TradeLeg } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { InfoButton } from "@/components/InfoButton";
import { HonestEmpty } from "@/components/HonestEmpty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { num, time, titleCase, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  trades: SimulatedTrade[];
  demoOn: boolean;
  onEnableDemo: () => void;
}

/** A per-leg fill-state chip (B / S with a color by state). */
function LegChip({ leg }: { leg: TradeLeg }) {
  const label = leg.side === "buy" ? "B" : "S";
  const cls =
    leg.state === "rejected"
      ? "border-loss/50 bg-loss/15 text-loss"
      : leg.state === "partial"
        ? "border-warn/50 bg-warn/15 text-warn"
        : "border-profit/40 bg-profit/10 text-profit";
  const glyph = leg.state === "rejected" ? "✕" : leg.state === "partial" ? "◑" : "✓";
  return (
    <span
      title={`${leg.side} ${leg.exchange}: ${leg.state} (${num(leg.filledSize, 4)})`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded border px-1 text-[10px] font-semibold tabular-nums",
        cls,
      )}
    >
      {label}
      {glyph}
    </span>
  );
}

/** Leg-state chips plus the residual-resolution outcome for one trade. */
function StateBadges({ trade: t }: { trade: SimulatedTrade }) {
  // Older server builds may not carry per-leg state; degrade gracefully instead
  // of throwing (which would blank the whole dashboard).
  if (!t.buyLeg || !t.sellLeg) {
    return t.partial ? <Badge variant="warn">PARTIAL</Badge> : <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <LegChip leg={t.buyLeg} />
      <LegChip leg={t.sellLeg} />
      {t.resolution === "rehedged" && (
        <Badge
          variant="warn"
          title={`Residual ${num(t.residualBtc, 4)} BTC → re-hedged flat · ${usd(t.resolutionPnlUsd)}`}
        >
          RE-HEDGED
        </Badge>
      )}
      {t.resolution === "unwound" && (
        <Badge
          variant="loss"
          title={`Residual ${num(t.residualBtc, 4)} BTC → unwound flat · ${usd(t.resolutionPnlUsd)}`}
        >
          UNWOUND
        </Badge>
      )}
      {t.resolution === "none" && t.partial && <Badge variant="warn">PARTIAL</Badge>}
    </div>
  );
}

/**
 * A fill is "imperfect" when it didn't land as two cleanly-filled legs: a partial
 * fill, a rejected/partial leg, or a residual that had to be re-hedged/unwound.
 * These are exactly the cases the execution state machine exists to handle, so a
 * filter for them makes the robustness story tangible.
 */
function isImperfect(t: SimulatedTrade): boolean {
  if (t.partial) return true;
  if (t.resolution && t.resolution !== "none") return true;
  const legs = [t.buyLeg, t.sellLeg];
  return legs.some((l) => l && l.state !== "filled");
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function TradeBlotter({ trades, demoOn, onEnableDemo }: Props) {
  const [residualOnly, setResidualOnly] = useState(false);
  const imperfectCount = useMemo(() => trades.filter(isImperfect).length, [trades]);
  const visible = useMemo(
    () => (residualOnly ? trades.filter(isImperfect) : trades),
    [trades, residualOnly],
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Trade blotter — simulated fills</CardTitle>
          <InfoButton titleKey="info.blotter.title" bodyKey="info.blotter.body" />
        </div>
        {trades.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3 w-3 text-muted-foreground/60" />
            <FilterChip active={!residualOnly} onClick={() => setResidualOnly(false)}>
              All
            </FilterChip>
            <FilterChip active={residualOnly} onClick={() => setResidualOnly((v) => !v)}>
              Residual / partial{imperfectCount > 0 ? ` (${imperfectCount})` : ""}
            </FilterChip>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        {trades.length === 0 ? (
          <HonestEmpty demoOn={demoOn} onEnableDemo={onEnableDemo} />
        ) : (
        <ScrollArea className="h-full">
          <Table className="[&_td]:px-1.5 [&_th]:px-1.5">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead>Legs / state</TableHead>
                <TableHead className="text-right">Buy</TableHead>
                <TableHead className="text-right">Sell</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No partial or residual fills yet — every trade landed as two clean
                    legs. Dial up a reject/liquidity scenario in Parameters to exercise
                    the state machine.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((t) => (
                <TableRow
                  key={t.id}
                  className={t.netProfit >= 0 ? "animate-flash-green" : "animate-flash-red"}
                >
                  <TableCell className="text-muted-foreground">{time(t.executedAt)}</TableCell>
                  <TableCell>
                    {titleCase(t.buyExchange)} → {titleCase(t.sellExchange)}
                  </TableCell>
                  <TableCell className="text-right">{num(t.filledSize, 4)}</TableCell>
                  <TableCell>
                    <StateBadges trade={t} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{usd(t.avgBuyPrice, 0)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{usd(t.avgSellPrice, 0)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{usd(t.fees, 0)}</TableCell>
                  <TableCell
                    className={
                      "text-right font-semibold " +
                      (t.netProfit >= 0 ? "text-profit" : "text-loss")
                    }
                  >
                    {usd(t.netProfit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
