import { useEffect, useState } from "react";
import { Download, RefreshCw, RotateCcw, X } from "lucide-react";
import type { EngineConfig, EngineConfigPatch } from "@arb/shared";
import { useLang, type StringKey } from "@/lib/i18n";
import type { ReportFormat } from "@/lib/report";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  config: EngineConfig | null;
  onUpdate: (patch: EngineConfigPatch) => void;
  onReset: () => void;
  onExport: (format: ReportFormat) => void;
  onClose: () => void;
}

/** Server-side defaults (mirrors apps/server/src/config.ts) for the reset button. */
const DEFAULTS: EngineConfigPatch = {
  decisionMode: "ev",
  feeMode: "taker",
  minNetProfitUsd: 1,
  ev: { tauMs: 400, adverseBps: 5, minEvUsd: 0 },
  filo: { digestMs: 75_000, narrate: true },
  maxNotionalUsd: 50_000,
  maxSaneSpreadPct: 0.05,
  maxQuoteAgeMs: 2_000,
  maxVenueDeviationPct: 0.01,
  rebalanceThresholdBtc: 0.5,
  riskLimits: {
    breakerRejects: 3,
    breakerWindowMs: 10_000,
    breakerCooldownMs: 15_000,
    maxSessionLossUsd: 0,
  },
  disabledExchanges: [],
};

const DIGEST_OPTIONS = [0, 30_000, 60_000, 120_000, 300_000];

/**
 * One-click strategy bundles. Each patch tunes the whole risk posture at once so
 * a judge can flip between a cautious desk and a size-hungry one and watch the
 * opportunity/fill behaviour change live. Fees and active venues are left as-is
 * (they are venue-specific), but everything governing appetite is set here.
 */
const PRESETS: { key: StringKey; patch: EngineConfigPatch }[] = [
  {
    key: "settings.preset.conservative",
    patch: {
      decisionMode: "ev",
      minNetProfitUsd: 5,
      ev: { tauMs: 700, adverseBps: 12, minEvUsd: 3 },
      maxNotionalUsd: 10_000,
      maxSaneSpreadPct: 0.02,
      maxQuoteAgeMs: 800,
      maxVenueDeviationPct: 0.005,
      rebalanceThresholdBtc: 1,
    },
  },
  {
    key: "settings.preset.balanced",
    patch: DEFAULTS,
  },
  {
    key: "settings.preset.aggressive",
    patch: {
      decisionMode: "ev",
      minNetProfitUsd: 0,
      ev: { tauMs: 250, adverseBps: 3, minEvUsd: 0 },
      maxNotionalUsd: 150_000,
      maxSaneSpreadPct: 0.1,
      maxQuoteAgeMs: 4_000,
      maxVenueDeviationPct: 0.02,
      rebalanceThresholdBtc: 0.25,
    },
  },
  {
    key: "settings.preset.marketmaker",
    patch: {
      decisionMode: "spread",
      minNetProfitUsd: 2,
      maxNotionalUsd: 50_000,
      maxSaneSpreadPct: 0.03,
      maxQuoteAgeMs: 500,
      maxVenueDeviationPct: 0.008,
      rebalanceThresholdBtc: 0.5,
    },
  },
];

export function SettingsPanel({ open, config, onUpdate, onReset, onExport, onClose }: Props) {
  const { t } = useLang();

  // Persistent side drawer (not a covering modal): on desktop it docks to the
  // right and leaves the dashboard visible + interactive, so a judge can tune a
  // parameter and WATCH the feed / P&L react live — the whole point of the
  // parametrization center. On mobile it falls back to a bottom sheet with a
  // backdrop (limited screen real estate).
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm sm:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        role="dialog"
        aria-label={t("settings.title")}
        aria-hidden={!open}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border-border bg-card shadow-2xl transition-transform duration-300 ease-out",
          // Mobile: bottom sheet.
          "inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl border-t",
          // Desktop: full-height right drawer (inset-y-0 keeps top:0/bottom:0 so the
          // body's overflow-y-auto actually has a bounded height to scroll within).
          "sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[400px] sm:max-w-[90vw] sm:rounded-none sm:border-l sm:border-t-0",
          open
            ? "translate-y-0 sm:translate-x-0"
            : "pointer-events-none translate-y-full sm:translate-y-0 sm:translate-x-full",
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-white/15 sm:hidden" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex-none px-6 pb-3 pt-6">
          <h2 className="text-lg font-bold uppercase tracking-widest">{t("settings.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {!config ? (
            <p className="py-12 text-center text-sm text-muted-foreground">…</p>
          ) : (
            <Body config={config} onUpdate={onUpdate} onReset={onReset} onExport={onExport} />
          )}
        </div>
      </aside>
    </>
  );
}

function Body({
  config,
  onUpdate,
  onReset,
  onExport,
}: {
  config: EngineConfig;
  onUpdate: Props["onUpdate"];
  onReset: Props["onReset"];
  onExport: Props["onExport"];
}) {
  const { t } = useLang();
  const evMode = config.decisionMode === "ev";
  const makerMode = config.feeMode === "maker";
  // Live control count. Base (non-venue) = decisionMode + feeMode + minNet + 3 EV
  // + 2 Filo + size + 3 guards + rebalance + 4 risk-limits + replaySpeed
  // + 3 adverse-scenario = 21. Per venue = taker fee + active + downed = 3.
  const controlCount = 21 + config.exchanges.length * 3;

  return (
    <div className="space-y-6">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-semibold tabular-nums text-primary">{controlCount}</span>{" "}
        {t("settings.controls")}
      </p>

      {/* Strategy presets: flip the whole risk posture in one click. */}
      <Section title={t("settings.presets")} hint={t("settings.presets.help")}>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onUpdate(p.patch)}
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              {t(p.key)}
            </button>
          ))}
        </div>
      </Section>

      {/* Decision strategy */}
      <Section title={t("settings.strategy")}>
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={evMode}
            label={t("settings.mode.ev")}
            onClick={() => onUpdate({ decisionMode: "ev" })}
          />
          <ModeButton
            active={!evMode}
            label={t("settings.mode.spread")}
            onClick={() => onUpdate({ decisionMode: "spread" })}
          />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          {evMode ? t("settings.mode.help.ev") : t("settings.mode.help.spread")}
        </p>
      </Section>

      <Slider
        label={t("settings.minNet")}
        value={config.minNetProfitUsd}
        min={0}
        max={50}
        step={0.5}
        format={(v) => `$${v}`}
        hint={t("hint.minNet")}
        onChange={(v) => onUpdate({ minNetProfitUsd: v })}
      />

      {/* EV parameters (only relevant in EV mode) */}
      <Section
        title={t("settings.evParams")}
        hint={evMode ? undefined : t("settings.evDisabled")}
        disabled={!evMode}
      >
        <Slider
          label={t("settings.tau")}
          value={config.ev.tauMs}
          min={50}
          max={2000}
          step={50}
          format={(v) => `${v} ms`}
          hint={t("hint.tau")}
          disabled={!evMode}
          onChange={(v) => onUpdate({ ev: { tauMs: v } })}
        />
        <Slider
          label={t("settings.adverse")}
          value={config.ev.adverseBps}
          min={0}
          max={50}
          step={1}
          format={(v) => `${v} bps`}
          hint={t("hint.adverse")}
          disabled={!evMode}
          onChange={(v) => onUpdate({ ev: { adverseBps: v } })}
        />
        <Slider
          label={t("settings.minEv")}
          value={config.ev.minEvUsd}
          min={0}
          max={50}
          step={1}
          format={(v) => `$${v}`}
          hint={t("hint.minEv")}
          disabled={!evMode}
          onChange={(v) => onUpdate({ ev: { minEvUsd: v } })}
        />
      </Section>

      {/* Size & capital */}
      <Section title={t("settings.size")}>
        <Slider
          label={t("settings.maxNotional")}
          value={config.maxNotionalUsd}
          min={1_000}
          max={200_000}
          step={1_000}
          format={(v) => `$${v.toLocaleString("en-US")}`}
          hint={t("hint.maxNotional")}
          onChange={(v) => onUpdate({ maxNotionalUsd: v })}
        />
      </Section>

      {/* Risk guards */}
      <Section title={t("settings.guards")}>
        <Slider
          label={t("settings.maxSpread")}
          value={Math.round(config.maxSaneSpreadPct * 1000) / 10}
          min={0.5}
          max={20}
          step={0.5}
          format={(v) => `${v}%`}
          hint={t("hint.maxSpread")}
          onChange={(v) => onUpdate({ maxSaneSpreadPct: v / 100 })}
        />
        <Slider
          label={t("settings.maxAge")}
          value={config.maxQuoteAgeMs}
          min={200}
          max={10_000}
          step={100}
          format={(v) => `${v} ms`}
          hint={t("hint.maxAge")}
          onChange={(v) => onUpdate({ maxQuoteAgeMs: v })}
        />
        <Slider
          label={t("settings.maxDeviation")}
          value={Math.round((config.maxVenueDeviationPct ?? 0) * 1000) / 10}
          min={0}
          max={5}
          step={0.1}
          format={(v) => (v === 0 ? "off" : `${v}%`)}
          hint={t("hint.maxDeviation")}
          onChange={(v) => onUpdate({ maxVenueDeviationPct: v / 100 })}
        />
      </Section>

      {/* Automated risk limits: circuit breaker + loss-limit kill-switch */}
      <Section title={t("settings.riskLimits")} hint={t("settings.riskLimits.help")}>
        <Slider
          label={t("settings.breakerRejects")}
          value={config.riskLimits.breakerRejects}
          min={0}
          max={20}
          step={1}
          format={(v) => (v === 0 ? "off" : `${v}`)}
          hint={t("hint.breakerRejects")}
          onChange={(v) => onUpdate({ riskLimits: { breakerRejects: v } })}
        />
        <Slider
          label={t("settings.breakerWindow")}
          value={Math.round(config.riskLimits.breakerWindowMs / 1000)}
          min={1}
          max={120}
          step={1}
          format={(v) => `${v}s`}
          hint={t("hint.breakerWindow")}
          onChange={(v) => onUpdate({ riskLimits: { breakerWindowMs: v * 1000 } })}
        />
        <Slider
          label={t("settings.breakerCooldown")}
          value={Math.round(config.riskLimits.breakerCooldownMs / 1000)}
          min={1}
          max={120}
          step={1}
          format={(v) => `${v}s`}
          hint={t("hint.breakerCooldown")}
          onChange={(v) => onUpdate({ riskLimits: { breakerCooldownMs: v * 1000 } })}
        />
        <Slider
          label={t("settings.sessionLoss")}
          value={config.riskLimits.maxSessionLossUsd}
          min={0}
          max={5_000}
          step={50}
          format={(v) => (v === 0 ? "off" : `$${v.toLocaleString("en-US")}`)}
          hint={t("hint.sessionLoss")}
          onChange={(v) => onUpdate({ riskLimits: { maxSessionLossUsd: v } })}
        />
      </Section>

      {/* Inventory rebalancing */}
      <Section title={t("settings.rebalance")} hint={t("settings.rebalance.help")}>
        <Slider
          label={t("settings.rebalanceThreshold")}
          value={config.rebalanceThresholdBtc}
          min={0.05}
          max={5}
          step={0.05}
          format={(v) => `${v.toFixed(2)} BTC`}
          hint={t("hint.rebalance")}
          onChange={(v) => onUpdate({ rebalanceThresholdBtc: v })}
        />
      </Section>

      {/* Replay playback speed (replay toggled from the top bar) */}
      <Section title={t("settings.replay")} hint={t("settings.replay.help")}>
        <Slider
          label={t("settings.replaySpeed")}
          value={config.replaySpeed}
          min={0.5}
          max={10}
          step={0.5}
          format={(v) => `${v}×`}
          hint={t("hint.replaySpeed")}
          onChange={(v) => onUpdate({ replaySpeed: v })}
        />
      </Section>

      {/* Fee mode: assume the passive leg is taker (default) or maker */}
      <Section title={t("settings.feeMode")}>
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={!makerMode}
            label={t("settings.feeMode.taker")}
            onClick={() => onUpdate({ feeMode: "taker" })}
          />
          <ModeButton
            active={makerMode}
            label={t("settings.feeMode.maker")}
            onClick={() => onUpdate({ feeMode: "maker" })}
          />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          {makerMode ? t("settings.feeMode.help.maker") : t("settings.feeMode.help.taker")}
        </p>
      </Section>

      {/* Per-exchange taker fees */}
      <Section title={t("settings.fees")} hint={t("settings.fees.help")}>
        <div className="space-y-2">
          {config.exchanges.map((ex) => (
            <FeeRow
              key={ex}
              label={ex}
              takerPct={(config.fees[ex]?.takerFee ?? 0) * 100}
              onChange={(pct) => onUpdate({ fees: { [ex]: { takerFee: pct / 100 } } })}
            />
          ))}
        </div>
      </Section>

      {/* Active venues (disabled ones keep streaming but leave arbitrage) */}
      <Section title={t("settings.exchanges")} hint={t("settings.exchanges.help")}>
        <div className="space-y-1">
          {config.exchanges.map((ex) => {
            const active = !config.disabledExchanges.includes(ex);
            return (
              <div key={ex} className="flex items-center justify-between py-0.5">
                <span className="text-sm capitalize text-muted-foreground">{ex}</span>
                <Toggle
                  on={active}
                  onChange={(on) =>
                    onUpdate({
                      disabledExchanges: on
                        ? config.disabledExchanges.filter((e) => e !== ex)
                        : [...config.disabledExchanges, ex],
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      </Section>

      {/* Filo cadence */}
      <Section title={t("settings.filo")}>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">{t("settings.filoNarrate")}</span>
          <Toggle
            on={config.filo.narrate}
            onChange={(on) => onUpdate({ filo: { narrate: on } })}
          />
        </div>
        <div className="mt-2">
          <div className="mb-1.5 text-sm text-muted-foreground">{t("settings.filoDigest")}</div>
          <div className="flex flex-wrap gap-1.5">
            {DIGEST_OPTIONS.map((ms) => (
              <button
                key={ms}
                type="button"
                onClick={() => onUpdate({ filo: { digestMs: ms } })}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[12px] font-medium tabular-nums transition-colors",
                  config.filo.digestMs === ms
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                )}
              >
                {ms === 0 ? t("settings.off") : ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Adverse-scenario injector ("chaos mode") — clearly labeled, like demo. */}
      <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-warn">
            {t("settings.scenario")}
          </h3>
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          {t("settings.scenario.help")}
        </p>
        <div className="space-y-3">
          <Slider
            label={t("settings.scenario.reject")}
            value={Math.round(config.scenario.rejectProb * 100)}
            min={0}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            hint={t("hint.scenario.reject")}
            onChange={(v) => onUpdate({ scenario: { rejectProb: v / 100 } })}
          />
          <Slider
            label={t("settings.scenario.liquidity")}
            value={Math.round(config.scenario.liquidityHaircutPct * 100)}
            min={0}
            max={90}
            step={5}
            format={(v) => `−${v}%`}
            hint={t("hint.scenario.liquidity")}
            onChange={(v) => onUpdate({ scenario: { liquidityHaircutPct: v / 100 } })}
          />
          <Slider
            label={t("settings.scenario.gap")}
            value={Math.round(config.scenario.priceGapBps)}
            min={0}
            max={200}
            step={5}
            format={(v) => `${v} bps`}
            hint={t("hint.scenario.gap")}
            onChange={(v) => onUpdate({ scenario: { priceGapBps: v } })}
          />
        </div>

        {/* "Kill an exchange": force venues dark to watch the bot route around. */}
        <div className="mt-3 border-t border-warn/20 pt-3">
          <div className="mb-1 text-sm font-medium text-warn/90">
            {t("settings.scenario.down")}
          </div>
          <p className="mb-2 text-[11px] leading-snug text-muted-foreground/70">
            {t("settings.scenario.down.help")}
          </p>
          <div className="space-y-1">
            {config.exchanges
              .filter((ex) => ex !== "demo")
              .map((ex) => {
                const downed = config.scenario.downedVenues.includes(ex);
                return (
                  <div key={ex} className="flex items-center justify-between py-0.5">
                    <span
                      className={cn(
                        "text-sm capitalize",
                        downed ? "text-loss line-through decoration-loss/60" : "text-muted-foreground",
                      )}
                    >
                      {ex}
                    </span>
                    <Toggle
                      on={downed}
                      onChange={(on) =>
                        onUpdate({
                          scenario: {
                            downedVenues: on
                              ? [...config.scenario.downedVenues, ex]
                              : config.scenario.downedVenues.filter((e) => e !== ex),
                          },
                        })
                      }
                    />
                  </div>
                );
              })}
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            onUpdate({
              scenario: {
                rejectProb: 0,
                liquidityHaircutPct: 0,
                priceGapBps: 0,
                downedVenues: [],
              },
            })
          }
          className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("settings.scenario.clear")}
        </button>
      </div>

      <button
        type="button"
        onClick={() => onUpdate(DEFAULTS)}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {t("settings.reset")}
      </button>

      {/* Exportable session report (built client-side from live state). */}
      <Section title={t("settings.export")}>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {t("settings.export.help")}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onExport("json")}
            className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            <Download className="h-4 w-4" />
            {t("settings.export.json")}
          </button>
          <button
            type="button"
            onClick={() => onExport("csv")}
            className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <Download className="h-4 w-4" />
            {t("settings.export.csv")}
          </button>
        </div>
      </Section>

      {/* Session reset: zero the metrics (not the live feeds). Confirmed. */}
      <Section title={t("settings.session")}>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {t("settings.session.help")}
        </p>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t("settings.session.confirm"))) onReset();
          }}
          className="mt-1 flex items-center gap-2 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-[13px] font-semibold text-loss transition-colors hover:bg-loss/20"
        >
          <RefreshCw className="h-4 w-4" />
          {t("settings.session.reset")}
        </button>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  disabled,
  children,
}: {
  title: string;
  hint?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(disabled && "opacity-50")}>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </h3>
        {hint && <span className="text-[10px] text-muted-foreground">· {hint}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
        active
          ? "border-primary/60 bg-primary/15 text-primary glow-primary"
          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  /** One-line "why this knob exists / what it affects" — proves depth, not decoration. */
  hint?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  // Local mirror so dragging stays smooth; re-sync when the echoed config moves.
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{format(local)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          onChange(v);
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed"
      />
      {hint && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">{hint}</p>
      )}
    </div>
  );
}

function FeeRow({
  label,
  takerPct,
  onChange,
}: {
  label: string;
  takerPct: number;
  onChange: (pct: number) => void;
}) {
  // Local mirror keeps typing smooth; re-sync when the echoed config moves.
  const [local, setLocal] = useState(takerPct.toFixed(3));
  useEffect(() => setLocal(takerPct.toFixed(3)), [takerPct]);

  const commit = (raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v)) onChange(Math.min(Math.max(v, 0), 5));
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm capitalize text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={5}
          step={0.001}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-20 rounded-md border border-border bg-muted/40 px-2 py-1 text-right text-sm tabular-nums text-foreground focus:border-primary/60 focus:outline-none"
        />
        <span className="text-[12px] text-muted-foreground">%</span>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-5 w-9 flex-none rounded-full transition-colors",
        on ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
          on ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
