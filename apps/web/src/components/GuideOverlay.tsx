import { BookOpen, ClipboardCheck, ExternalLink, FlaskConical, Github, Radio, Route, Scale, X } from "lucide-react";
import { FilobotLogo } from "@/components/FilobotLogo";
import { useLang, type StringKey } from "@/lib/i18n";
import { DOC_LINKS } from "@/lib/repo";

interface Props {
  open: boolean;
  demoOn: boolean;
  onClose: () => void;
  onStartTour: () => void;
  onEnableDemo: () => void;
}

const HIGHLIGHTS = [
  { key: "f1", Icon: Radio },
  { key: "f2", Icon: Scale },
  { key: "f3", Icon: null }, // Filo uses the brand mark
] as const;

export function GuideOverlay({ open, demoOn, onClose, onStartTour, onEnableDemo }: Props) {
  const { t } = useLang();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] sm:max-h-[92vh] sm:max-w-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* gradient accent */}
        <div className="h-1 w-full flex-none bg-gradient-to-r from-primary via-cyan-400 to-primary" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-5 z-10 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6 pt-8">
          {/* Hero */}
          <div className="flex flex-col items-center text-center">
            <div className="h-14 w-14 drop-shadow-[0_0_24px_hsl(var(--primary)/0.55)]">
              <FilobotLogo />
            </div>
            <h2 className="mt-3 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-2xl font-bold uppercase tracking-[0.18em] text-transparent">
              Filobot
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              {t("guide.lead")}
            </p>
          </div>

          {/* Highlights */}
          <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {HIGHLIGHTS.map(({ key, Icon }) => (
              <div
                key={key}
                className="rounded-xl border border-white/[0.06] bg-muted/30 p-3.5 transition-colors hover:border-primary/30"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  {Icon ? <Icon className="h-4 w-4" /> : <FilobotLogo className="h-5 w-5" />}
                </div>
                <div className="mt-2.5 text-[13px] font-semibold text-foreground">
                  {t(`guide.${key}.title` as StringKey)}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t(`guide.${key}.body` as StringKey)}
                </p>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("guide.explore")}
            </button>
            <button
              type="button"
              onClick={onStartTour}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.7)] transition-opacity hover:opacity-90"
            >
              <Route className="h-4 w-4" />
              {t("guide.start")}
            </button>
          </div>

          {/* Demo hint — subtle, one line */}
          {!demoOn && (
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              {t("guide.demoHint")}{" "}
              <button
                type="button"
                onClick={onEnableDemo}
                className="inline-flex items-center gap-1 font-semibold text-warn transition-opacity hover:opacity-80"
              >
                <FlaskConical className="h-3 w-3" />
                {t("guide.enableDemo")}
              </button>
            </p>
          )}
        </div>

        {/* Resources */}
        <div className="flex flex-none flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-white/[0.06] bg-background/40 px-7 py-3.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {t("guide.resources")}
          </span>
          <ResLink href={DOC_LINKS.architecture} icon={<BookOpen className="h-3.5 w-3.5" />}>
            {t("guide.link.arch")}
          </ResLink>
          <ResLink href={DOC_LINKS.criteria} icon={<ClipboardCheck className="h-3.5 w-3.5" />}>
            {t("guide.link.criteria")}
          </ResLink>
          <ResLink href={DOC_LINKS.whyfilo} icon={<span className="text-[13px] leading-none">🐾</span>}>
            {t("guide.link.whyfilo")}
          </ResLink>
          <ResLink href={DOC_LINKS.repo} icon={<Github className="h-3.5 w-3.5" />}>
            {t("guide.link.repo")}
          </ResLink>
        </div>
      </div>
    </div>
  );
}

function ResLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {icon}
      {children}
      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
    </a>
  );
}
