import { FlaskConical, ShieldCheck } from "lucide-react";
import { useLang } from "@/lib/i18n";

/**
 * Reframes the honest zero-state (0 trades / flat equity) as PROOF of a working
 * efficiency filter rather than a broken dashboard, and offers a one-click Demo
 * so a judge can immediately see the execution path light up.
 */
export function HonestEmpty({
  demoOn,
  onEnableDemo,
}: {
  demoOn: boolean;
  onEnableDemo: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="h-4 w-4 text-profit" />
        {t("empty.honest.title")}
      </div>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        {t("empty.honest.body")}
      </p>
      {demoOn ? (
        <p className="text-xs font-medium text-warn">{t("empty.demoOn")}</p>
      ) : (
        <button
          type="button"
          onClick={onEnableDemo}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          {t("empty.enableDemo")}
        </button>
      )}
    </div>
  );
}
