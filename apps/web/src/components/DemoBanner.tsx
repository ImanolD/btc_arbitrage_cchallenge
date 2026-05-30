import { FlaskConical } from "lucide-react";

/**
 * Prominent, always-visible banner shown whenever the synthetic demo/replay
 * injector is active, so the simulated `demo` venue can never be mistaken for
 * a real, live arbitrage opportunity.
 */
export function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-warn">
      <FlaskConical className="h-3.5 w-3.5" />
      Demo / replay mode active — the “demo” venue injects synthetic price
      dislocations. Not real market data.
    </div>
  );
}
