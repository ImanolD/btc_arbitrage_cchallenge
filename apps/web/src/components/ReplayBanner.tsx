import { History } from "lucide-react";
import { useLang } from "@/lib/i18n";

/**
 * Prominent, always-visible banner shown while the market REPLAY injector is
 * active, so recorded (real) data replayed at variable speed can never be
 * mistaken for the current live market. Honest by design, like the demo banner.
 */
export function ReplayBanner() {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-center gap-2 border-b border-primary/40 bg-primary/10 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-primary">
      <History className="h-3.5 w-3.5" />
      {t("banner.replay")}
    </div>
  );
}
