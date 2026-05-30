import { FlaskConical, Route, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLang, type StringKey } from "@/lib/i18n";

interface Props {
  open: boolean;
  demoOn: boolean;
  onClose: () => void;
  onStartTour: () => void;
  onEnableDemo: () => void;
}

export function GuideOverlay({
  open,
  demoOn,
  onClose,
  onStartTour,
  onEnableDemo,
}: Props) {
  const { t } = useLang();
  if (!open) return null;

  const steps = [
    { n: "1", key: "market" as const },
    { n: "2", key: "opps" as const },
    { n: "3", key: "tri" as const },
    { n: "4", key: "stats" as const },
    { n: "5", key: "latency" as const },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-bold uppercase tracking-widest">
          {t("guide.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("guide.subtitle")}
        </p>

        <ol className="mt-5 space-y-3">
          {steps.map((step) => (
            <li key={step.n} className="flex gap-3">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {step.n}
              </span>
              <div>
                <div className="text-sm font-semibold">
                  {t(`tour.${step.key}.title` as StringKey)}
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {t(`tour.${step.key}.body` as StringKey)}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-4 py-3">
          <div className="text-[13px]">
            <div className="font-semibold text-warn">{t("guide.demoTitle")}</div>
            <p className="text-muted-foreground">
              {t("guide.demoBody")}{" "}
              <Badge variant="muted">synthetic</Badge>
            </p>
          </div>
          {!demoOn && (
            <button
              type="button"
              onClick={onEnableDemo}
              className="flex flex-none items-center gap-1.5 rounded-md border border-warn/50 bg-warn/15 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-warn transition-colors hover:bg-warn/25"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              {t("guide.enableDemo")}
            </button>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("guide.explore")}
          </button>
          <button
            type="button"
            onClick={onStartTour}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Route className="h-4 w-4" />
            {t("guide.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
