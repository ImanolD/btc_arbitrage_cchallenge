import type { PortfolioStats, VenueInventory } from "@arb/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { InfoButton } from "@/components/InfoButton";
import { num, time, titleCase, usd } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  portfolio: PortfolioStats | null;
}

/**
 * Inventory & rebalancing panel. Visualizes the (s,S) policy per venue — actual
 * BTC vs. target with the deadband [floor, ceiling] painted — plus remaining
 * capacity, a per-venue drift forecast, and a timeline of on-chain transfers.
 */
export function WalletsPanel({ portfolio }: Props) {
  const { t } = useLang();
  const inventory = portfolio?.inventory ?? [];
  const reb = portfolio?.rebalancing;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("wallets.title")}</CardTitle>
          <InfoButton titleKey="info.wallets.title" bodyKey="info.wallets.body" />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {reb && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Kpi label={t("wallets.kpi.transfers")} value={String(reb.events)} />
            <Kpi label={t("wallets.kpi.costPerTrade")} value={usd(reb.amortizedCostPerTradeUsd)} muted />
            <Kpi label={t("wallets.kpi.band")} value={`±${num(reb.bandBtc, 2)} ₿`} />
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2.5 pr-1">
            {inventory.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t("wallets.waiting")}
              </div>
            )}
            {inventory.map((v) => (
              <InventoryRow key={v.exchange} v={v} />
            ))}
          </div>
        </ScrollArea>

        {reb && reb.recentEvents.length > 0 && (
          <div className="flex-none border-t border-border pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("wallets.timeline")}
            </div>
            <div className="space-y-0.5">
              {reb.recentEvents.slice(0, 5).map((e, i) => (
                <div key={`${e.ts}-${i}`} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{time(e.ts)}</span>
                  <span className="tabular-nums">
                    {titleCase(e.fromExchange)} → {titleCase(e.toExchange)}
                  </span>
                  <span className="tabular-nums text-foreground">{num(e.amountBtc, 3)} ₿</span>
                  <span className="tabular-nums text-loss">−{usd(e.costUsd, 2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-md bg-muted/40 py-1.5">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

/** One venue: BTC-vs-target bar with the deadband painted, USD + capacity. */
function InventoryRow({ v }: { v: VenueInventory }) {
  const { t } = useLang();
  const band = v.ceilingBtc - v.targetBtc || v.targetBtc * 0.25 || 1;
  // Window the track around the target so the band is legible; widen it if the
  // actual balance has drifted beyond the usual view.
  const dev = Math.max(band * 2.2, Math.abs(v.btc - v.targetBtc) * 1.15);
  const lo = v.targetBtc - dev;
  const hi = v.targetBtc + dev;
  const span = hi - lo || 1;
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((x - lo) / span) * 100))}%`;

  const inBand = v.btc >= v.floorBtc && v.btc <= v.ceilingBtc;
  const dbLeft = pos(v.floorBtc);
  const dbWidth = `${(Math.min(v.ceilingBtc, hi) - Math.max(v.floorBtc, lo)) / span * 100}%`;

  // Drift forecast: direction + projected trades until the nearest band edge.
  const rising = v.driftPerTradeBtc > 0;
  const forecast =
    v.projectedTradesToBreach == null
      ? t("wallets.drift.stable")
      : (rising ? t("wallets.drift.toCeiling") : t("wallets.drift.toFloor")).replace(
          "{n}",
          String(v.projectedTradesToBreach),
        );
  const forecastArrow =
    v.projectedTradesToBreach == null ? "→" : rising ? "↑" : "↓";
  const forecastClass =
    v.projectedTradesToBreach == null
      ? "text-muted-foreground"
      : rising
        ? "text-warn"
        : "text-primary";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium">{titleCase(v.exchange)}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] tabular-nums text-muted-foreground">{usd(v.usd, 0)}</span>
          <Badge variant={v.capacityTrades > 0 ? "muted" : "loss"}>
            {v.capacityTrades} trades
          </Badge>
        </div>
      </div>
      <div className="relative h-2.5 w-full rounded-full bg-muted/50">
        {/* Deadband [floor, ceiling] */}
        <div
          className="absolute inset-y-0 rounded-full bg-primary/20"
          style={{ left: dbLeft, width: dbWidth }}
        />
        {/* Target tick (order-up-to level) */}
        <div
          className="absolute -top-0.5 h-3.5 w-px bg-foreground/70"
          style={{ left: pos(v.targetBtc) }}
        />
        {/* Current BTC marker */}
        <div
          className={cn(
            "absolute w-1 -translate-x-1/2 rounded-full",
            inBand ? "bg-profit" : "bg-loss",
          )}
          style={{ left: pos(v.btc), top: "-3px", height: "16px" }}
          title={`${num(v.btc, 4)} ₿ (target ${num(v.targetBtc, 2)}, band ±${num(band, 2)})`}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{num(v.btc, 3)} ₿</span>
        <span className={inBand ? "text-muted-foreground" : "text-loss"}>
          {inBand
            ? t("wallets.inBand")
            : v.btc > v.ceilingBtc
              ? t("wallets.aboveCeiling")
              : t("wallets.belowFloor")}
        </span>
      </div>
      <div className={cn("mt-0.5 text-[10px] tabular-nums", forecastClass)}>
        {forecastArrow} {forecast}
      </div>
    </div>
  );
}
