import type { Schema } from "@pulse/client";
import { useTranslation } from "react-i18next";
import type { LatLon } from "./platform.tsx";
import { LEG_STYLE } from "./transit.ts";
import type { Step } from "./trips.ts";

// A way step by step (design round 2026-11-25, Trips): start, every stop you get on or off at, the end; each a tap
// that shows it on the map.

type LegMode = Schema<"LegMode">;

export function WaySteps({ steps, timeZone, onStep }: { steps: Step[]; timeZone: string; onStep: (at: LatLon) => void }) {
  const { t } = useTranslation();
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const moveName = (mode: LegMode) => (mode === "walk" || mode === "bike" || mode === "car" ? t(`mode_${mode}`) : undefined);
  return (
    <ol aria-label={t("tripSteps")} className="way-steps">
      {steps.map((step, i) => {
        if (step.kind === "move") {
          const { icon: Icon } = LEG_STYLE[step.mode];
          const what = [moveName(step.mode), t("minutes", { count: step.minutes }), step.stops ? t("tripStops", { count: step.stops }) : undefined].filter(Boolean).join(" · ");
          return (
            <li key={i} className="way-step-move">
              <Icon aria-hidden className="size-4" />
              {what}
            </li>
          );
        }
        const colour = step.line ? LEG_STYLE[step.line.mode].colour : undefined;
        return (
          <li key={i}>
            <button type="button" className="way-step" data-kind={step.kind} onClick={() => onStep(step.at)}>
              <span className="way-step-time">{clock.format(new Date(step.time))}</span>
              <span aria-hidden className="way-step-mark" style={colour ? { borderColor: colour } : undefined}>
                {step.kind === "park" && "P"}
              </span>
              <span className="way-step-name">
                {step.name}
                {step.kind === "off" && <span className="way-step-note"> · {t("tripGetOff")}</span>}
              </span>
              {step.line && (
                <span className="way-step-line" style={{ backgroundColor: colour }}>
                  {step.line.name}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
