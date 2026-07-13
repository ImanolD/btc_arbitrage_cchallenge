import { OctagonX } from "lucide-react";
import { useLang } from "@/lib/i18n";

/**
 * Prominent banner shown while the session loss-limit kill-switch has halted all
 * execution. Detection keeps running underneath; a session reset (or realized
 * P&L recovering above the limit) clears it. Makes the drawdown breaker visible.
 */
export function HaltBanner() {
  const { t } = useLang();
  return (
    <div className="flex animate-pulse items-center justify-center gap-2 border-b border-loss/50 bg-loss/15 px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-loss">
      <OctagonX className="h-3.5 w-3.5" />
      {t("banner.halt")}
    </div>
  );
}
