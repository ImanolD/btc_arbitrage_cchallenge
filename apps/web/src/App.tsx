import { useEffect, useState } from "react";
import type { EngineConfig } from "@arb/shared";
import { useArbStream } from "@/hooks/useArbStream";
import { StatusBar } from "@/components/StatusBar";
import { StatCards } from "@/components/StatCards";
import { MarketPanel } from "@/components/MarketPanel";
import { OpportunityFeed } from "@/components/OpportunityFeed";
import { TradeBlotter } from "@/components/TradeBlotter";
import { WalletsPanel } from "@/components/WalletsPanel";
import { EquityChart } from "@/components/EquityChart";
import { LatencyPanel } from "@/components/LatencyPanel";
import { TriangularPanel } from "@/components/TriangularPanel";
import { DemoBanner } from "@/components/DemoBanner";
import { AdverseScenarioBanner } from "@/components/AdverseScenarioBanner";
import { GuideOverlay } from "@/components/GuideOverlay";
import { StatsPanel } from "@/components/StatsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { FiloChat } from "@/components/FiloChat";
import { CoverPage } from "@/components/CoverPage";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { startTour } from "@/lib/tour";
import { downloadSessionReport, type ReportFormat } from "@/lib/report";

const GUIDE_SEEN_KEY = "arb_guide_seen";

/** True when any adverse-scenario injector knob is dialed above zero. */
function scenarioActive(config: EngineConfig | null): boolean {
  const s = config?.scenario;
  return !!s && (s.rejectProb > 0 || s.liquidityHaircutPct > 0 || s.priceGapBps > 0);
}

export default function App() {
  const state = useArbStream();
  const { t } = useLang();
  const [entered, setEntered] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Auto-open the guide on first visit — but only after the cover is dismissed,
  // so the onboarding doesn't stack behind the splash.
  useEffect(() => {
    if (entered && localStorage.getItem(GUIDE_SEEN_KEY) !== "1") setGuideOpen(true);
  }, [entered]);

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
    <div
      className={cn(
        "flex min-h-screen flex-col overflow-x-hidden bg-background transition-[padding] duration-300 ease-out",
        // Make room for the docked parameters drawer on desktop so nothing hides behind it.
        settingsOpen && "sm:pr-[400px]",
      )}
    >
      {!entered && (
        <CoverPage connected={state.connected} onEnter={() => setEntered(true)} />
      )}
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
        onReset={state.resetSession}
        onExport={(format: ReportFormat) =>
          downloadSessionReport(
            {
              config: state.config,
              portfolio: state.portfolio,
              stats: state.stats,
              trades: state.trades,
            },
            format,
          )
        }
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
      {scenarioActive(state.config) && <AdverseScenarioBanner />}

      <main className="flex flex-1 flex-col gap-3 p-3">
        <div id="tour-stats">
          <StatCards portfolio={state.portfolio} startedAt={state.config?.startedAt} />
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
          {/* Left rail: live market + latency */}
          <div className="flex flex-col gap-3 lg:col-span-3">
            <div id="tour-market">
              <MarketPanel books={state.books} feeds={state.feeds} />
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
              <EquityChart
                portfolio={state.portfolio}
                demoOn={state.config?.demoMode ?? false}
                onEnableDemo={() => state.setDemo(true)}
              />
            </div>
            <div id="tour-wallets" className="h-[300px]">
              <WalletsPanel portfolio={state.portfolio} />
            </div>
            <div className="min-h-0 flex-1">
              <TradeBlotter
                trades={state.trades}
                demoOn={state.config?.demoMode ?? false}
                onEnableDemo={() => state.setDemo(true)}
              />
            </div>
          </div>
        </div>
      </main>

      <FiloChat messages={state.filo} onAsk={state.askFilo} />
    </div>
  );
}
