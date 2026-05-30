import { useMemo } from "react";
import type { TopOfBook } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { num, titleCase, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  books: Record<string, TopOfBook>;
}

export function MarketPanel({ books }: Props) {
  const rows = useMemo(
    () =>
      Object.values(books).sort(
        (a, b) =>
          a.quote.localeCompare(b.quote) || a.exchange.localeCompare(b.exchange),
      ),
    [books],
  );

  const bestCross = useMemo(() => {
    let best:
      | { buy: TopOfBook; sell: TopOfBook; edge: number; quote: string }
      | null = null;
    for (const a of rows) {
      for (const b of rows) {
        if (a.exchange === b.exchange) continue;
        // Only compare venues quoting the same asset (USDT vs USD differ by peg).
        if (a.quote !== b.quote) continue;
        const edge = b.bestBid - a.bestAsk; // buy on a, sell on b
        if (best === null || edge > best.edge) {
          best = { buy: a, sell: b, edge, quote: a.quote };
        }
      }
    }
    return best;
  }, [rows]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Market — best bid / ask</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Exchange</TableHead>
              <TableHead>Quote</TableHead>
              <TableHead className="text-right">Bid</TableHead>
              <TableHead className="text-right">Ask</TableHead>
              <TableHead className="text-right">Spread</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">
                  Waiting for market data…
                </TableCell>
              </TableRow>
            )}
            {rows.map((b) => (
              <TableRow key={b.exchange}>
                <TableCell className="font-medium">{titleCase(b.exchange)}</TableCell>
                <TableCell>
                  <Badge variant="muted">{b.quote}</Badge>
                </TableCell>
                <TableCell className="text-right text-profit">{usd(b.bestBid)}</TableCell>
                <TableCell className="text-right text-loss">{usd(b.bestAsk)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {usd(b.bestAsk - b.bestBid)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {bestCross && (
          <div
            className={cn(
              "mt-3 flex items-center justify-between rounded-md border px-3 py-2",
              bestCross.edge > 0
                ? "border-profit/40 bg-gradient-to-r from-profit/15 to-transparent"
                : "border-border bg-muted/30",
            )}
          >
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Best cross edge
            </span>
            <div className="flex items-center gap-2">
              <Badge variant="muted">
                Buy {titleCase(bestCross.buy.exchange)} → Sell{" "}
                {titleCase(bestCross.sell.exchange)}
              </Badge>
              <span
                className={
                  bestCross.edge > 0
                    ? "font-bold tabular-nums text-profit glow-profit"
                    : "font-bold tabular-nums text-muted-foreground"
                }
              >
                {bestCross.edge > 0 ? "+" : ""}
                {num(bestCross.edge)} {bestCross.quote}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
