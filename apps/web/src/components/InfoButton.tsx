import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { OTHER_LANG, tn, useLang, type StringKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  titleKey: StringKey;
  bodyKey: StringKey;
  className?: string;
}

const PANEL_WIDTH = 320;

export function InfoButton({ titleKey, bodyKey, className }: Props) {
  const { lang, t } = useLang();
  const other = OTHER_LANG[lang];
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(
        Math.max(8, r.right - PANEL_WIDTH),
        window.innerWidth - PANEL_WIDTH - 8,
      );
      setPos({ top: r.bottom + 8, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={t("info.label")}
        className={cn(
          "flex h-4 w-4 flex-none items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:text-primary",
          open && "text-primary",
          className,
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            className="fixed z-[60] rounded-lg border border-white/[0.12] bg-popover/95 p-3.5 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-foreground">
              {t(titleKey)}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {t(bodyKey)}
            </p>
            <div className="mt-2.5 border-t border-border/60 pt-2">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {other.toUpperCase()}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground/80">
                {tn(other, titleKey)}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                {tn(other, bodyKey)}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
