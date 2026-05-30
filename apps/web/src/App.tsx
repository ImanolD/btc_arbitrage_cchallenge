import { useEffect, useState } from "react";
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
import { GuideOverlay } from "@/components/GuideOverlay";
import { StatsPanel } from "@/components/StatsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { FiloChat } from "@/components/FiloChat";
import { useLang } from "@/lib/i18n";
import { startTour } from "@/lib/tour";

const GUIDE_SEEN_KEY = "arb_guide_seen";

export default function App() {
  const state = useArbStream();
  const { t } = useLang();
  const [guideOpen, setGuideOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Auto-open the guide on first visit so judges aren't dropped into a cold UI.
  useEffect(() => {
    if (localStorage.getItem(GUIDE_SEEN_KEY) !== "1") setGuideOpen(true);
  }, []);

  const closeGuide = () => {
    localStorage.setItem(GUIDE_SEEN_KEY, "1");
    setGuideOpen(false);
  };

  const launchTour = () => {
    closeGuide();
    // Defer so the overlay unmounts before driver.js measures the layout.
    setTimeout(() => startTour(t, () => state.setDemo(true)), 80);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <GuideOverlay
        open={guideOpen}
        demoOn={state.config?.demoMode ?? false}
        onClose={closeGuide}
        onStartTour={launchTour}
        onEnableDemo={() => {
          state.setDemo(true);
          closeGuide();
        }}
      />
      <StatsPanel
        open={statsOpen}
        stats={state.stats}
        onClose={() => setStatsOpen(false)}
      />
      <SettingsPanel
        open={settingsOpen}
        config={state.config}
        onUpdate={state.updateConfig}
        onClose={() => setSettingsOpen(false)}
      />
      <StatusBar
        connected={state.connected}
        config={state.config}
        feeds={state.feeds}
        latency={state.latency}
        onToggleDemo={state.setDemo}
        onOpenGuide={() => setGuideOpen(true)}
        onStartTour={launchTour}
        onOpenStats={() => setStatsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {state.config?.demoMode && <DemoBanner />}

      <main className="flex flex-1 flex-col gap-3 p-3">
        <div id="tour-stats">
          <StatCards portfolio={state.portfolio} />
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
          {/* Left rail: live market + latency */}
          <div className="flex flex-col gap-3 lg:col-span-3">
            <div id="tour-market">
              <MarketPanel books={state.books} />
            </div>
            <div id="tour-latency" className="min-h-[200px] flex-1">
              <LatencyPanel latency={state.latency} />
            </div>
          </div>

          {/* Center: detection */}
          <div className="flex min-h-[480px] flex-col gap-3 lg:col-span-5">
            <div id="tour-opps" className="min-h-0 flex-1">
              <OpportunityFeed opportunities={state.opportunities} />
            </div>
            <div id="tour-tri" className="flex-none">
              <TriangularPanel triangular={state.triangular} config={state.config} />
            </div>
          </div>

          {/* Right rail: execution evidence (P&L + fills) */}
          <div
            id="tour-charts"
            className="flex min-h-[480px] flex-col gap-3 lg:col-span-4"
          >
            <div className="h-[240px]">
              <EquityChart portfolio={state.portfolio} />
            </div>
            <div className="min-h-0 flex-1">
              <TradeBlotter trades={state.trades} />
            </div>
          </div>
        </div>
      </main>

      <FiloChat messages={state.filo} onAsk={state.askFilo} />
    </div>
  );
}
