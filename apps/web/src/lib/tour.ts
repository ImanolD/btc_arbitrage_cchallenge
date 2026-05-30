import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { StringKey } from "@/lib/i18n";

type T = (key: StringKey) => string;

interface TourStep {
  selector: string;
  titleKey: StringKey;
  bodyKey: StringKey;
  side?: "top" | "right" | "bottom" | "left";
}

const STEPS: TourStep[] = [
  { selector: "#tour-market", titleKey: "tour.market.title", bodyKey: "tour.market.body", side: "right" },
  { selector: "#tour-opps", titleKey: "tour.opps.title", bodyKey: "tour.opps.body", side: "left" },
  { selector: "#tour-tri", titleKey: "tour.tri.title", bodyKey: "tour.tri.body", side: "left" },
  { selector: "#tour-stats", titleKey: "tour.stats.title", bodyKey: "tour.stats.body", side: "bottom" },
  { selector: "#tour-charts", titleKey: "tour.charts.title", bodyKey: "tour.charts.body", side: "top" },
  { selector: "#tour-latency", titleKey: "tour.latency.title", bodyKey: "tour.latency.body", side: "right" },
  { selector: "#tour-filo", titleKey: "tour.filo.title", bodyKey: "tour.filo.body", side: "left" },
  { selector: "#tour-settings", titleKey: "tour.settings.title", bodyKey: "tour.settings.body", side: "bottom" },
  { selector: "#tour-demo", titleKey: "tour.demo.title", bodyKey: "tour.demo.body", side: "bottom" },
];

/**
 * Launches the spotlight tour. The final step targets the Demo toggle and,
 * when the user clicks "Finish", enables demo mode so the dashboard comes alive.
 */
export function startTour(t: T, onEnableDemo: () => void) {
  const steps = STEPS.filter((s) => document.querySelector(s.selector));

  const obj = driver({
    showProgress: true,
    allowClose: true,
    overlayColor: "#04070d",
    overlayOpacity: 0.72,
    stagePadding: 6,
    stageRadius: 8,
    nextBtnText: t("tour.next"),
    prevBtnText: t("tour.prev"),
    doneBtnText: t("tour.demo.cta"),
    steps: steps.map((s) => ({
      element: s.selector,
      popover: {
        title: t(s.titleKey),
        description: t(s.bodyKey),
        side: s.side,
        align: "start",
      },
    })),
    onDestroyStarted: () => {
      // hasNextStep() is false only on the final step → user clicked "Finish".
      if (!obj.hasNextStep()) onEnableDemo();
      obj.destroy();
    },
  });

  obj.drive();
}
