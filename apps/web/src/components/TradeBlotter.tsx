import type { SimulatedTrade } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { num, time, titleCase, usd } from "@/lib/format";

interface Props {
  trades: SimulatedTrade[];
}

export function TradeBlotter({ trades }: Props) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Trade blotter — simulated fills</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="text-right">Buy</TableHead>
                <TableHead className="text-right">Sell</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    No trades executed yet.
                  </TableCell>
                </TableRow>
              )}
              {trades.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground">{time(t.executedAt)}</TableCell>
                  <TableCell>
                    {titleCase(t.buyExchange)} → {titleCase(t.sellExchange)}
                  </TableCell>
                  <TableCell className="text-right">
                    {num(t.filledSize, 4)}
                    {t.partial && (
                      <Badge variant="warn" className="ml-1">
                        PARTIAL
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{usd(t.avgBuyPrice)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{usd(t.avgSellPrice)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{usd(t.fees)}</TableCell>
                  <TableCell className="text-right font-semibold text-profit">
                    {usd(t.netProfit)}
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
