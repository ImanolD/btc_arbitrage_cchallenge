import type { Opportunity } from "@arb/shared";
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
import { ms, num, time, titleCase, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  opportunities: Opportunity[];
}

export function OpportunityFeed({ opportunities }: Props) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Opportunity feed — gross vs net</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Proc.</TableHead>
                <TableHead className="text-right">Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    No crosses detected yet. Real BTC arbs are rare — that's expected.
                  </TableCell>
                </TableRow>
              )}
              {opportunities.map((opp) => (
                <TableRow key={opp.id} className="animate-flash-green">
                  <TableCell className="text-muted-foreground">{time(opp.detectedAt)}</TableCell>
                  <TableCell>
                    {titleCase(opp.buyExchange)} → {titleCase(opp.sellExchange)}
                  </TableCell>
                  <TableCell className="text-right">{num(opp.size, 4)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
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
