import { Zap } from "lucide-react";
import { useLang } from "@/lib/i18n";

/**
 * Prominent, always-visible banner shown whenever the adverse-scenario injector
 * ("chaos mode") is active, so the injected order rejects / liquidity crunches /
 * price gaps can never be mistaken for real market conditions. Honest by design,
 * exactly like the demo banner.
 */
export function AdverseScenarioBanner() {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-center gap-2 border-b border-loss/40 bg-loss/10 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-loss">
      <Zap className="h-3.5 w-3.5" />
      {t("banner.scenario")}
    </div>
  );
}
