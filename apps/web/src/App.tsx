import { useArbStream } from "@/hooks/useArbStream";
import { StatusBar } from "@/components/StatusBar";
import { StatCards } from "@/components/StatCards";
import { MarketPanel } from "@/components/MarketPanel";
import { OpportunityFeed } from "@/components/OpportunityFeed";
import { TradeBlotter } from "@/components/TradeBlotter";
import { EquityChart } from "@/components/EquityChart";
import { LatencyPanel } from "@/components/LatencyPanel";
import { TriangularPanel } from "@/components/TriangularPanel";
import { DemoBanner } from "@/components/DemoBanner";

export default function App() {
  const state = useArbStream();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <StatusBar
        connected={state.connected}
        config={state.config}
        feeds={state.feeds}
        latency={state.latency}
        onToggleDemo={state.setDemo}
      />
      {state.config?.demoMode && <DemoBanner />}

      <main className="flex flex-1 flex-col gap-3 p-3">
        <StatCards portfolio={state.portfolio} />

        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            <MarketPanel books={state.books} />
            <LatencyPanel latency={state.latency} />
          </div>

          <div className="flex min-h-[360px] flex-col gap-3 lg:col-span-2">
            <OpportunityFeed opportunities={state.opportunities} />
            <TriangularPanel triangular={state.triangular} config={state.config} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="min-h-[280px]">
            <EquityChart portfolio={state.portfolio} />
          </div>
          <div className="flex min-h-[280px] flex-col">
            <TradeBlotter trades={state.trades} />
          </div>
        </div>
      </main>
    </div>
  );
}
