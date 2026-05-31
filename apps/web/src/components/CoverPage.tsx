import { useState } from "react";
import { ArrowRight, Github, Linkedin, Loader2 } from "lucide-react";
import { FilobotLogo } from "@/components/FilobotLogo";
import { AUTHOR, REPO_URL } from "@/lib/repo";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  /** True once the Socket.IO stream is connected — gates the CTA. */
  connected: boolean;
  onEnter: () => void;
}

/**
 * Full-screen brand cover / splash. Doubles as a real loading gate: the CTA
 * stays in a "connecting" state until the live stream is up, then a polished
 * fade/scale/blur transition reveals the dashboard.
 */
export function CoverPage({ connected, onEnter }: Props) {
  const { t } = useLang();
  const [leaving, setLeaving] = useState(false);

  const enter = () => {
    if (leaving || !connected) return;
    setLeaving(true);
    // Let the exit animation play before unmounting and revealing the app.
    window.setTimeout(onEnter, 700);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background transition-all duration-700 ease-out",
        leaving
          ? "pointer-events-none scale-105 opacity-0 [filter:blur(10px)]"
          : "scale-100 opacity-100",
      )}
    >
      {/* Ambient glows */}
      <div className="pointer-events-none absolute -top-1/4 left-1/2 h-[60vh] w-[60vh] -translate-x-1/2 rounded-full bg-primary/20 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-1/4 right-1/5 h-[42vh] w-[42vh] rounded-full bg-cyan-400/10 blur-[130px]" />
      {/* Subtle grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <div className="relative flex flex-col items-center px-6 text-center">
        {/* Logo with pulsing halo */}
        <div className="animate-in fade-in zoom-in-50 fill-mode-both relative mb-7 h-28 w-28 duration-700">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:2.4s]" />
          <div className="relative h-full w-full drop-shadow-[0_0_28px_hsl(var(--primary)/0.55)]">
            <FilobotLogo />
          </div>
        </div>

        {/* Wordmark */}
        <h1
          className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-5xl font-black uppercase tracking-[0.3em] text-transparent duration-700 sm:text-6xl"
          style={{ animationDelay: "120ms" }}
        >
          Filobot
        </h1>
        <p
          className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-4 max-w-md text-sm leading-relaxed text-muted-foreground duration-700 sm:text-base"
          style={{ animationDelay: "220ms" }}
        >
          {t("cover.tagline")}
        </p>

        {/* CTA — reflects real connection state */}
        <div
          className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both mt-9 duration-700"
          style={{ animationDelay: "340ms" }}
        >
          <button
            type="button"
            onClick={enter}
            disabled={!connected}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-full px-8 py-3.5 text-sm font-bold uppercase tracking-widest transition-all",
              connected
                ? "bg-primary text-primary-foreground shadow-[0_0_40px_-8px_hsl(var(--primary))] hover:scale-105"
                : "cursor-wait bg-muted text-muted-foreground",
            )}
          >
            {connected ? (
              <>
                {t("cover.enter")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("cover.connecting")}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Credits */}
      <div
        className="animate-in fade-in fill-mode-both absolute bottom-8 flex flex-col items-center gap-3 duration-700"
        style={{ animationDelay: "480ms" }}
      >
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
          {t("cover.createdBy")}{" "}
          <a
            href={AUTHOR.linkedin}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-foreground transition-colors hover:text-primary"
          >
            {AUTHOR.handle}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <CoverLink href={AUTHOR.linkedin} icon={<Linkedin className="h-4 w-4" />} label="LinkedIn" />
          <CoverLink href={REPO_URL} icon={<Github className="h-4 w-4" />} label="GitHub" />
        </div>
      </div>
    </div>
  );
}

function CoverLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground backdrop-blur-md transition-colors hover:border-primary/40 hover:text-foreground"
    >
      {icon}
      {label}
    </a>
  );
}
