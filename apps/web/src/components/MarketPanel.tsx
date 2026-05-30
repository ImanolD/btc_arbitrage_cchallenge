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

interface Props {
  books: Record<string, TopOfBook>;
}

export function MarketPanel({ books }: Props) {
  const rows = Object.values(books);

  const bestCross = useMemo(() => {
    let best: { buy: TopOfBook; sell: TopOfBook; edge: number } | null = null;
    for (const a of rows) {
      for (const b of rows) {
        if (a.exchange === b.exchange) continue;
        const edge = b.bestBid - a.bestAsk; // buy on a, sell on b
        if (best === null || edge > best.edge) best = { buy: a, sell: b, edge };
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
              <TableHead className="text-right">Bid</TableHead>
              <TableHead className="text-right">Ask</TableHead>
              <TableHead className="text-right">Spread</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                  Waiting for market data…
                </TableCell>
              </TableRow>
            )}
            {rows.map((b) => (
              <TableRow key={b.exchange}>
                <TableCell className="font-medium">{titleCase(b.exchange)}</TableCell>
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
          <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
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
                    ? "font-bold tabular-nums text-profit"
                    : "font-bold tabular-nums text-muted-foreground"
                }
              >
                {bestCross.edge > 0 ? "+" : ""}
                {num(bestCross.edge)} USDT
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
