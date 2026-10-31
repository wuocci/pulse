import type { GeocodeResult, Impact, Schema, TravelMode } from "@pulse/client";
import { BadgeCheck, Bike, Bus, Footprints, type LucideIcon, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddressSearch } from "./AddressSearch.tsx";
import type { LatLon } from "./platform.tsx";
import { LEG_STYLE } from "./transit.ts";

// Trip mode: From (the point unless changed) and To, then every travel mode at once with its time and how much
// is in the way, so the choice of mode is the comparison.

export const TRAVEL_MODES: TravelMode[] = ["transit", "walk", "bike"];
const MODE_ICONS: Record<TravelMode, LucideIcon> = { transit: Bus, walk: Footprints, bike: Bike };

export interface TripFormProps {
  point: LatLon | undefined;
  lang: string;
  fromName: string | undefined;
  toName: string | undefined;
  onFrom: (place: GeocodeResult) => void;
  onTo: (place: GeocodeResult) => void;
  onClose: () => void;
}

export function TripForm({ point, lang, fromName, toName, onFrom, onTo, onClose }: TripFormProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-2">
        <AddressSearch point={point} lang={lang} label={t("from")} placeholder={t("fromHere")} initialText={fromName ?? ""} onPick={onFrom} />
        <AddressSearch point={point} lang={lang} label={t("to")} placeholder={t("toPlaceholder")} initialText={toName ?? ""} autoFocus={!toName} onPick={onTo} />
      </div>
      <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t("closeRoute")} onClick={onClose}>
        <X aria-hidden />
      </Button>
    </div>
  );
}

export interface TravelModesProps {
  // Only what the chips show, so any shape of a planned Trip fits.
  trip: { plans: { mode: TravelMode; itineraries: { durationS: number; impact: Impact }[] }[]; recommended?: { mode: TravelMode } } | undefined;
  mode: TravelMode;
  // Which of each mode's itineraries its chip speaks for: the chosen one, else the recommended one, else the first.
  shownIndex: (mode: TravelMode) => number;
  onMode: (mode: TravelMode) => void;
}

export function TravelModes({ trip, mode, shownIndex, onMode }: TravelModesProps) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex min-w-0 flex-1 gap-1 rounded-lg bg-muted p-1">
      <legend className="sr-only">{t("travelMode")}</legend>
      {TRAVEL_MODES.map((option) => {
        const Icon = MODE_ICONS[option];
        const plan = trip?.plans.find((p) => p.mode === option);
        const best = plan?.itineraries[shownIndex(option)] ?? plan?.itineraries[0];
        const better = trip?.recommended?.mode === option;
        const time = best ? t("minutes", { count: Math.round(best.durationS / 60) }) : plan ? t("noRoute") : undefined;
        const impact = best && (best.impact === "consider" || best.impact === "major") ? best.impact : undefined;
        const label = [t(`mode_${option}`), time, impact && t(`impact_${impact}`), better && t("betterToday")].filter(Boolean).join(", ");
        return (
          <label
            key={option}
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium has-checked:bg-background has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input type="radio" name="mode" className="sr-only" aria-label={label} checked={mode === option} onChange={() => onMode(option)} />
            <Icon aria-hidden className="size-4 shrink-0" />
            <span aria-hidden className={`truncate ${best ? "" : "text-muted-foreground"}`}>
              {time ?? "…"}
            </span>
            {impact && <ImpactMark impact={impact} />}
            {better && <BadgeCheck aria-hidden className="size-4 shrink-0 text-emerald-600" />}
          </label>
        );
      })}
    </fieldset>
  );
}

function ImpactMark({ impact }: { impact: Extract<Impact, "consider" | "major"> }) {
  return impact === "major" ? (
    <OctagonAlert aria-hidden className="size-4 shrink-0 text-red-600" />
  ) : (
    <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-600" />
  );
}

type Itinerary = Pick<Schema<"Itinerary">, "start" | "end" | "durationS" | "impact"> & {
  legs: Pick<Schema<"Leg">, "mode" | "line" | "start" | "end">[];
};

export interface ItinerariesProps {
  itineraries: Itinerary[];
  chosen: number;
  // The one that's better today in this mode, and what it avoids.
  better?: { index: number; avoids?: string };
  timeZone: string;
  onChoose: (index: number) => void;
}

// The chosen mode's ways, each with its legs (which line where), times and Impact.
export function Itineraries({ itineraries, chosen, better, timeZone, onChoose }: ItinerariesProps) {
  const { t } = useTranslation();
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const minutes = (from: string, to: string) => t("minutes", { count: Math.round((Date.parse(to) - Date.parse(from)) / 60_000) });

  return (
    <fieldset className="space-y-1">
      <legend className="sr-only">{t("routes")}</legend>
      {itineraries.map((itinerary, i) => {
        const legs = itinerary.legs.map((leg) => `${t(`leg_${leg.mode}`)} ${leg.line ? leg.line.name : minutes(leg.start, leg.end)}`).join(", ");
        const times = `${clock.format(new Date(itinerary.start))}–${clock.format(new Date(itinerary.end))}`;
        const impact = itinerary.impact === "consider" || itinerary.impact === "major" ? itinerary.impact : undefined;
        const isBetter = better?.index === i;
        const why = isBetter ? [t("betterToday"), ...(better?.avoids ? [t("avoids", { what: better.avoids })] : [])].join(", ") : undefined;
        const label = `${legs.charAt(0).toUpperCase()}${legs.slice(1)}. ${[times, minutes(itinerary.start, itinerary.end), impact && t(`impact_${impact}`), why].filter(Boolean).join(", ")}`;
        return (
          <label
            key={i}
            className="flex cursor-pointer flex-col gap-1.5 rounded-lg p-2 has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input type="radio" name="route" className="sr-only" aria-label={label} checked={chosen === i} onChange={() => onChoose(i)} />
            <span aria-hidden className="flex flex-wrap items-center gap-1">
              {itinerary.legs.map((leg, j) => {
                const { icon: Icon, colour } = LEG_STYLE[leg.mode];
                return leg.line ? (
                  <span key={j} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: colour }}>
                    <Icon className="size-3.5" />
                    {leg.line.name}
                  </span>
                ) : (
                  <span key={j} className="flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Icon className="size-3.5" />
                    {Math.round((Date.parse(leg.end) - Date.parse(leg.start)) / 60_000)}
                  </span>
                );
              })}
            </span>
            <span aria-hidden className="flex items-center gap-2 text-sm">
              <span className="tabular-nums">{times}</span>
              <span className="text-muted-foreground">{minutes(itinerary.start, itinerary.end)}</span>
              {impact && <ImpactMark impact={impact} />}
            </span>
            {why && (
              <span aria-hidden className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                <BadgeCheck className="size-3.5 shrink-0" />
                {why}
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
