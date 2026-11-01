import type { GeocodeResult, Impact, Schema, TravelMode } from "@pulse/client";
import { BadgeCheck, Bike, Bus, Car, Footprints, type LucideIcon, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddressSearch } from "./AddressSearch.tsx";
import type { LatLon } from "./platform.tsx";
import { LEG_STYLE } from "./transit.ts";

// Trip mode: From (the point unless changed) and To, then every travel mode at once with its time and how much
// is in the way, so the choice of mode is the comparison.

export const TRAVEL_MODES: TravelMode[] = ["transit", "walk", "bike", "car"];
const MODE_ICONS: Record<TravelMode, LucideIcon> = { transit: Bus, walk: Footprints, bike: Bike, car: Car };

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
        // A car's time ignores traffic (Digitransit's free-flow times): shown as "~" and said so.
        const count = best ? Math.round(best.durationS / 60) : 0;
        const freeFlow = option === "car";
        const time = best ? t(freeFlow ? "minutesNoTraffic" : "minutes", { count }) : plan ? t("noRoute") : undefined;
        const shownTime = best && freeFlow ? `~${t("minutes", { count })}` : time;
        const impact = best && (best.impact === "consider" || best.impact === "major") ? best.impact : undefined;
        const label = [t(`mode_${option}`), time, impact && t(`impact_${impact}`), better && t("betterToday")].filter(Boolean).join(", ");
        return (
          <label
            key={option}
            // The icon above the time: four chips fit a phone's sheet and the docked panel alike.
            className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs font-medium has-checked:bg-background has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input type="radio" name="mode" className="sr-only" aria-label={label} checked={mode === option} onChange={() => onMode(option)} />
            <Icon aria-hidden className="size-4 shrink-0" />
            <span aria-hidden className="flex max-w-full items-center gap-1">
              <span className={`truncate ${best ? "" : "text-muted-foreground"}`}>{shownTime ?? "…"}</span>
              {impact && <ImpactMark impact={impact} />}
              {better && <BadgeCheck className="size-4 shrink-0 text-emerald-600" />}
            </span>
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
  legs: (Pick<Schema<"Leg">, "mode" | "line" | "start" | "end"> & { to?: { parking?: string } })[];
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
        const legs = itinerary.legs
          .map((leg) => {
            const what = `${t(`leg_${leg.mode}`)} ${leg.line ? leg.line.name : minutes(leg.start, leg.end)}`;
            return leg.to?.parking ? `${what} ${t("toParking", { name: leg.to.parking })}` : what;
          })
          .join(", ");
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
                const parkAt = leg.to?.parking && (
                  <span key={`${j}-p`} className="flex items-center gap-1 rounded bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                    P<span className="font-normal">{leg.to.parking}</span>
                  </span>
                );
                if (parkAt) {
                  return [
                    <span key={j} className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Icon className="size-3.5" />
                      {Math.round((Date.parse(leg.end) - Date.parse(leg.start)) / 60_000)}
                    </span>,
                    parkAt,
                  ];
                }
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

export interface ParkingNearProps {
  parking: NonNullable<Schema<"Trip">["parking"]>;
  place: string;
}

// Where to leave the car at B: the street parking around it (how many spaces, of which kind) and the nearest car
// parks. Static data: the kinds of spaces, not whether any are free now. Credited to its Sources.
export function ParkingNear({ parking: { street, carParks, sources }, place }: ParkingNearProps) {
  const { t } = useTranslation();
  const kinds = street
    ? [
        street.paid && t("parkingPaid", { count: street.paid }),
        street.free && t("parkingFree", { count: street.free }),
        street.ev && t("parkingEv", { count: street.ev }),
        street.accessible && t("parkingAccessible", { count: street.accessible }),
      ].filter(Boolean)
    : [];
  return (
    <section aria-label={t("parkingNear", { place })} className="space-y-1.5 rounded-lg border p-3 text-sm">
      <h3 className="flex items-center gap-2 font-medium">
        <span aria-hidden className="grid size-5 place-items-center rounded bg-blue-600 text-xs font-bold text-white">
          P
        </span>
        {t("parkingNear", { place })}
      </h3>
      {street && (
        <p>
          {t("parkingSpaces", { count: street.spaces, radius: street.radiusM })}
          {kinds.length > 0 && <span className="block text-muted-foreground">{kinds.join(" · ")}</span>}
        </p>
      )}
      {carParks.length > 0 && (
        <ul>
          {carParks.map((park) => (
            <li key={park.name}>{t("carPark", { name: park.name, spaces: park.carSpaces, distance: park.distanceM })}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("parkingSources", { sources: sources.join(", ") })}</p>
    </section>
  );
}
