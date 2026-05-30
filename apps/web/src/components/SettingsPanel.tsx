import { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import type { EngineConfig, EngineConfigPatch } from "@arb/shared";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  config: EngineConfig | null;
  onUpdate: (patch: EngineConfigPatch) => void;
  onClose: () => void;
}

/** Server-side defaults (mirrors apps/server/src/config.ts) for the reset button. */
const DEFAULTS: EngineConfigPatch = {
  decisionMode: "ev",
  minNetProfitUsd: 1,
  ev: { tauMs: 400, adverseBps: 5, minEvUsd: 0 },
  filo: { digestMs: 75_000, narrate: true },
};

const DIGEST_OPTIONS = [0, 30_000, 60_000, 120_000, 300_000];

export function SettingsPanel({ open, config, onUpdate, onClose }: Props) {
  const { t } = useLang();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[88vh] sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
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
            <Body config={config} onUpdate={onUpdate} />
          )}
        </div>
      </div>
    </div>
  );
}

function Body({ config, onUpdate }: { config: EngineConfig; onUpdate: Props["onUpdate"] }) {
  const { t } = useLang();
  const evMode = config.decisionMode === "ev";

  return (
    <div className="space-y-6">
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
          disabled={!evMode}
          onChange={(v) => onUpdate({ ev: { minEvUsd: v } })}
        />
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

      <button
        type="button"
        onClick={() => onUpdate(DEFAULTS)}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {t("settings.reset")}
      </button>
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
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
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
