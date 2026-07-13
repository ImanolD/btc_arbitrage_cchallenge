import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  FlaskConical,
  Github,
  HelpCircle,
  History,
  Menu,
  Radio,
  Route,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { EngineConfig, FeedStatus, LatencyStats } from "@arb/shared";
import { Badge } from "@/components/ui/badge";
import { FilobotLogo } from "@/components/FilobotLogo";
import { ms, titleCase, uptime as fmtUptime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { REPO_URL } from "@/lib/repo";

interface Props {
  connected: boolean;
  config: EngineConfig | null;
  feeds: FeedStatus[];
  latency: LatencyStats | null;
  onToggleDemo: (enabled: boolean) => void;
  onToggleReplay: (enabled: boolean) => void;
  onOpenGuide: () => void;
  onStartTour: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}

export function StatusBar({
  connected,
  config,
  feeds,
  latency,
  onToggleDemo,
  onToggleReplay,
  onOpenGuide,
  onStartTour,
  onOpenStats,
  onOpenSettings,
}: Props) {
  const { lang, setLang, t } = useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const demoOn = config?.demoMode ?? false;
  const replayOn = config?.replayMode ?? false;
  const modeLabel = config ? (config.decisionMode === "ev" ? "EV" : "Spread") : null;
  // Live-tunable control count (mirrors SettingsPanel: 21 base + 3 per venue).
  const controlCount = config ? 21 + config.exchanges.length * 3 : null;
  const close = () => setMenuOpen(false);

  // Ticking uptime for the "live since" pill (once a minute is plenty).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const up = config?.startedAt ? fmtUptime(config.startedAt, now) : null;
  const liveSince = config?.startedAt
    ? `Live since ${new Date(config.startedAt).toLocaleString()}`
    : undefined;

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/[0.06] bg-card/60 px-4 py-2.5 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 drop-shadow-[0_0_12px_hsl(var(--primary)/0.5)]">
          <FilobotLogo />
        </div>
        <div className="leading-tight">
          <div className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-sm font-bold uppercase tracking-[0.2em] text-transparent">
            Filobot
          </div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Cross-exchange BTC arbitrage engine
          </div>
        </div>
        {config && (
          <Badge variant="muted" className="ml-1">
            {config.symbol}
          </Badge>
        )}
      </div>

      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-2.5 py-1",
          connected ? "border-profit/30 bg-profit/10" : "border-loss/30 bg-loss/10",
        )}
        title={connected ? liveSince : undefined}
      >
        <span className="relative flex h-2 w-2">
          {connected && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-70" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              connected ? "bg-profit" : "bg-loss",
            )}
          />
        </span>
        <span
          className={cn(
            "text-[11px] font-bold uppercase tracking-wider",
            connected ? "text-profit" : "text-loss",
          )}
        >
          {connected ? "Live" : "Offline"}
        </span>
        {connected && up && (
          <>
            <span className="h-3 w-px bg-white/15" />
            <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
              {up}
            </span>
          </>
        )}
      </div>

      <div id="tour-feeds" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {feeds.map((feed) => (
          <FeedDot key={feed.exchange} feed={feed} />
        ))}
      </div>

      {/* Desktop actions (lg+) */}
      <div className="ml-auto hidden items-center gap-3 lg:flex">
        <div
          className="flex items-center gap-1.5"
          title="Processing latency p50 / p95 (our code only)"
        >
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold tabular-nums text-primary glow-primary">
            {ms(latency?.processing.p50 ?? null)} / {ms(latency?.processing.p95 ?? null)}
          </span>
        </div>

        <NavButton
          id="tour-demo"
          icon={<FlaskConical className="h-3.5 w-3.5" />}
          label={`Demo ${demoOn ? "ON" : "OFF"}`}
          active={demoOn}
          onClick={() => onToggleDemo(!demoOn)}
          title="Toggle the clearly-labeled synthetic demo injector"
        />
        <NavButton
          icon={<History className="h-3.5 w-3.5" />}
          label={`Replay ${replayOn ? "ON" : "OFF"}`}
          active={replayOn}
          onClick={() => onToggleReplay(!replayOn)}
          title={t("nav.replay")}
        />
        <button
          id="tour-settings"
          type="button"
          onClick={onOpenSettings}
          title={t("nav.params.tip")}
          className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t("nav.params")}
          {modeLabel && (
            <span className="rounded bg-primary/20 px-1 py-px text-[10px] tabular-nums">
              {modeLabel}
            </span>
          )}
          {controlCount != null && (
            <span className="rounded bg-background/50 px-1 py-px text-[10px] tabular-nums text-muted-foreground">
              {controlCount}
            </span>
          )}
        </button>
        {/* Secondary nav: icon-only (labels as tooltips) to keep the bar for
            identity + live status + feeds + the two primary actions above. */}
        <span className="mx-0.5 h-5 w-px bg-white/10" />
        <NavButton
          iconOnly
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label={t("nav.stats")}
          onClick={onOpenStats}
        />
        <NavButton
          iconOnly
          icon={<Route className="h-3.5 w-3.5" />}
          label={t("nav.tour")}
          onClick={onStartTour}
        />
        <NavButton
          iconOnly
          icon={<HelpCircle className="h-3.5 w-3.5" />}
          label={t("nav.guide")}
          onClick={onOpenGuide}
        />
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          title={t("nav.repo")}
          aria-label={t("nav.repo")}
        >
          <Github className="h-3.5 w-3.5" />
        </a>
        <LangToggle lang={lang} setLang={setLang} />
      </div>

      {/* Mobile hamburger (below lg) */}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        aria-label={t("nav.menu")}
      >
        <Menu className="h-4 w-4" />
        {t("nav.menu")}
      </button>

      {/* Mobile drawer */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={close}
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-white/[0.08] bg-card shadow-2xl lg:hidden">
            <div className="flex flex-none items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <span className="text-sm font-bold uppercase tracking-widest">
                {t("nav.menu")}
              </span>
              <button
                type="button"
                onClick={close}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
              <MenuRow
                icon={<FlaskConical className="h-4 w-4" />}
                label="Demo"
                onClick={() => onToggleDemo(!demoOn)}
                trailing={
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      demoOn ? "bg-warn/20 text-warn" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {demoOn ? "ON" : "OFF"}
                  </span>
                }
              />
              <MenuRow
                icon={<History className="h-4 w-4" />}
                label="Replay"
                onClick={() => onToggleReplay(!replayOn)}
                trailing={
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      replayOn ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {replayOn ? "ON" : "OFF"}
                  </span>
                }
              />
              <MenuRow
                icon={<SlidersHorizontal className="h-4 w-4" />}
                label={t("nav.params")}
                onClick={() => {
                  onOpenSettings();
                  close();
                }}
                trailing={
                  <span className="flex items-center gap-1">
                    {modeLabel && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                        {modeLabel}
                      </span>
                    )}
                    {controlCount != null && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                        {controlCount}
                      </span>
                    )}
                  </span>
                }
              />
              <MenuRow
                icon={<BarChart3 className="h-4 w-4" />}
                label={t("nav.stats")}
                onClick={() => {
                  onOpenStats();
                  close();
                }}
              />
              <MenuRow
                icon={<Route className="h-4 w-4" />}
                label={t("nav.tour")}
                onClick={() => {
                  onStartTour();
                  close();
                }}
              />
              <MenuRow
                icon={<HelpCircle className="h-4 w-4" />}
                label={t("nav.guide")}
                onClick={() => {
                  onOpenGuide();
                  close();
                }}
              />
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                onClick={close}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Github className="h-4 w-4" />
                {t("nav.repo")}
              </a>

              <div className="mt-2 border-t border-white/[0.06] pt-3">
                <div className="mb-2 px-3 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  {t("nav.lang")}
                </div>
                <div className="px-3">
                  <LangToggle lang={lang} setLang={setLang} full />
                </div>
              </div>

              <div className="mt-auto flex items-center gap-2 border-t border-white/[0.06] px-3 pt-3 text-[11px] text-muted-foreground">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <span>p50/p95</span>
                <span className="ml-auto font-semibold tabular-nums text-primary">
                  {ms(latency?.processing.p50 ?? null)} / {ms(latency?.processing.p95 ?? null)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}

/**
 * A single venue's live feed indicator. Color encodes connection + consensus
 * health: green = healthy & in consensus, amber = connecting/stale, red =
 * disconnected, and a pulsing red strike-through = quarantined by the
 * dislocated-feed guard (excluded from arbitrage). The tooltip carries the
 * deviation vs consensus in bps — the visible face of that robustness guard.
 */
function FeedDot({ feed }: { feed: FeedStatus }) {
  const { t } = useLang();
  const connected = feed.status === "connected";
  // Adverse "downed" venues are force-disconnected; the circuit breaker benches a
  // still-connected venue. Precedence: downed → dislocated → benched → stale.
  const downed = feed.downed === true;
  const dislocated = connected && feed.dislocated === true;
  const benched = connected && feed.benched === true && !dislocated;
  const stale = connected && feed.stale === true && !dislocated && !benched;
  // Struck through whenever the venue is out of arbitrage for any reason.
  const excluded = downed || dislocated || benched;

  const dotClass = downed
    ? "text-loss"
    : !connected
      ? feed.status === "connecting"
        ? "text-warn"
        : "text-loss"
      : dislocated || benched
        ? "text-loss"
        : stale
          ? "text-warn"
          : "text-profit";

  const statusText = downed
    ? t("feed.downed")
    : !connected
      ? feed.status === "connecting"
        ? t("feed.connecting")
        : t("feed.down")
      : dislocated
        ? t("feed.dislocated")
        : benched
          ? t("feed.benched")
          : stale
            ? t("feed.stale")
            : t("feed.healthy");

  const dev = feed.deviationBps != null ? ` · ${feed.deviationBps} bps` : "";

  return (
    <div
      className="flex items-center gap-1.5"
      title={`${titleCase(feed.exchange)}: ${statusText}${dev}`}
    >
      <Radio
        className={cn(
          "h-3.5 w-3.5",
          dotClass,
          (dislocated || benched) && "animate-pulse",
        )}
      />
      <span
        className={cn(
          "text-[11px]",
          excluded ? "text-loss line-through decoration-loss/60" : "text-muted-foreground",
        )}
      >
        {titleCase(feed.exchange)}
      </span>
    </div>
  );
}

function NavButton({
  id,
  icon,
  label,
  active,
  onClick,
  title,
  iconOnly,
}: {
  id?: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
  /** Render only the icon (label becomes the tooltip/aria) to declutter the bar. */
  iconOnly?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      className={cn(
        "flex items-center gap-1.5 rounded-md border text-[11px] font-semibold uppercase tracking-wider transition-colors",
        iconOnly ? "px-2 py-1.5" : "px-2.5 py-1",
        active
          ? "border-warn/50 bg-warn/15 text-warn"
          : "border-border bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {!iconOnly && label}
    </button>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon}
      <span>{label}</span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </button>
  );
}

function LangToggle({
  lang,
  setLang,
  full,
}: {
  lang: "es" | "en";
  setLang: (l: "es" | "en") => void;
  full?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden rounded-md border border-border",
        full && "w-full",
      )}
    >
      {(["es", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          className={cn(
            "py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
            full ? "flex-1" : "px-2",
            lang === code
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
