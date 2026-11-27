import type { GeocodeResult, Impact, Schema, TravelMode } from "@pulse/client";
import { BadgeCheck, Bike, Bus, CalendarClock, Car, Footprints, type LucideIcon, OctagonAlert, Star, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddressSearch } from "./AddressSearch.tsx";
import { PlaceForm } from "./Places.tsx";
import { savedAt, usePlaces } from "./places.ts";
import { crowdText } from "./rowWords.ts";
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
  // Where To is, once set: it can be saved as one of your places.
  to?: LatLon | undefined;
  onFrom: (place: GeocodeResult) => void;
  onTo: (place: GeocodeResult) => void;
  onClose: () => void;
}

// Where from and where to, in the place of Around's "Near" and "Where to?" (same rows, same look), so opening a Trip
// reads as the bar turning into the field it asked for.
export function TripForm({ point, lang, fromName, toName, to, onFrom, onTo, onClose }: TripFormProps) {
  const { t } = useTranslation();
  const { places } = usePlaces();
  const [saving, setSaving] = useState(false);
  const unsaved = to && !savedAt(places, to);
  return (
    <div className="space-y-3">
      <div className="around-top">
        <button type="button" className="around-back" aria-label={t("closeRoute")} onClick={onClose}>
          ‹ {t("closeRoute")}
        </button>
      </div>
      {/* From and To marked as on the map: a ring where you start, a dark dot where you're going. */}
      <div className="trip-field" data-end="from">
        <span aria-hidden className="trip-field-tag">
          {t("from")}
        </span>
        <AddressSearch
          point={point}
          lang={lang}
          label={t("from")}
          placeholder={t("fromHere")}
          initialText={fromName ?? ""}
          onPick={onFrom}
          withPlaces
          inputClassName="trip-input"
          leading={<span className="end-mark" data-end="from" />}
        />
      </div>
      <div className="trip-field" data-end="to">
        <span aria-hidden className="trip-field-tag">
          {t("to")}
        </span>
        {/* Anew when To is set elsewhere (a long press on the map), so it shows it. */}
        <AddressSearch
          key={toName ?? ""}
          point={point}
          lang={lang}
          label={t("to")}
          placeholder={t("toPlaceholder")}
          initialText={toName ?? ""}
          autoFocus={!toName}
          onPick={onTo}
          withPlaces
          inputClassName="trip-input"
          leading={<span className="end-mark" data-end="to" />}
        />
      </div>
      {unsaved && !saving && (
        <button type="button" className="here-save" onClick={() => setSaving(true)}>
          <Star aria-hidden className="size-4" />
          {!toName || toName === t("pointOnMap") ? t("pressSave") : t("tripSaveTo", { name: toName })}
        </button>
      )}
      {unsaved && saving && <PlaceForm key={`${to.lat},${to.lon}`} at={to} name={toName === t("pointOnMap") ? "" : (toName ?? "")} onDone={() => setSaving(false)} />}
    </div>
  );
}

// On a phone's map, once there's a way to show: where from and to in one line, which opens back to the fields.
export function TripRoute({ fromName, toName, onEdit, onClose }: { fromName: string; toName: string; onEdit: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="trip-route">
      <button type="button" className="trip-route-back" aria-label={t("closeRoute")} onClick={onClose}>
        ‹
      </button>
      <button type="button" className="trip-route-edit" aria-label={t("tripRouteEdit", { from: fromName, to: toName })} onClick={onEdit}>
        <span className="truncate">{fromName}</span>
        <span aria-hidden>→</span>
        <span className="truncate">{toName}</span>
      </button>
    </div>
  );
}

export interface TravelModesProps {
  // Only what the chips show, so any shape of a planned Trip fits.
  trip: { plans: { mode: TravelMode; itineraries: { durationS: number; impact: Impact; legs?: { mode: string }[] }[] }[]; recommended?: { mode: TravelMode } } | undefined;
  mode: TravelMode;
  // Which of each mode's itineraries its chip speaks for: the chosen one, else the recommended one, else the first.
  shownIndex: (mode: TravelMode) => number;
  onMode: (mode: TravelMode) => void;
}

export function TravelModes({ trip, mode, shownIndex, onMode }: TravelModesProps) {
  const { t } = useTranslation();
  return (
    <fieldset className="modes">
      <legend className="sr-only">{t("travelMode")}</legend>
      {TRAVEL_MODES.map((option) => {
        const Icon = MODE_ICONS[option];
        const plan = trip?.plans.find((p) => p.mode === option);
        const best = plan?.itineraries[shownIndex(option)] ?? plan?.itineraries[0];
        const better = trip?.recommended?.mode === option;
        // A drive ignores traffic (Digitransit's free-flow times): shown as "~" and said so. Not park-and-ride's ride.
        const count = best ? Math.round(best.durationS / 60) : 0;
        const freeFlow = option === "car" && (best?.legs ?? []).every((leg) => leg.mode === "car" || leg.mode === "walk");
        const time = best ? t(freeFlow ? "minutesNoTraffic" : "minutes", { count }) : plan ? t("noRoute") : undefined;
        const shownTime = best && freeFlow ? `~${t("minutes", { count })}` : time;
        const impact = best && (best.impact === "consider" || best.impact === "major") ? best.impact : undefined;
        const label = [t(`mode_${option}`), time, impact && t(`impact_${impact}`), better && t("betterToday")].filter(Boolean).join(", ");
        return (
          <label
            key={option}
            // Stacked — icon, name, time — so four fit a phone's sheet and the docked panel alike; marks in the corner.
            className="mode-tile"
          >
            <input type="radio" name="mode" className="sr-only" aria-label={label} checked={mode === option} onChange={() => onMode(option)} />
            {(impact || better) && (
              <span aria-hidden className="mode-tile-marks [&_svg]:size-3.5">
                {impact && <ImpactMark impact={impact} />}
                {better && <BadgeCheck className="shrink-0 text-(--s-link)" />}
              </span>
            )}
            <Icon aria-hidden className="size-5 shrink-0" />
            <span aria-hidden className="mode-tile-name">
              {t(`modeShort_${option}`)}
            </span>
            <span aria-hidden className="mode-tile-time">
              {shownTime ?? "…"}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ImpactMark({ impact }: { impact: Extract<Impact, "consider" | "major"> }) {
  return impact === "major" ? (
    <OctagonAlert aria-hidden className="size-4 shrink-0 text-(--s-red-text)" />
  ) : (
    <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-600" />
  );
}

type Itinerary = Pick<Schema<"Itinerary">, "start" | "end" | "durationS" | "impact"> & {
  onTheWay: Pick<Schema<"OnTheWay">, "eventId" | "impact" | "minutes" | "crowd">[];
  legs: (Pick<Schema<"Leg">, "mode" | "line" | "start" | "end" | "distanceM"> & { to?: Pick<Schema<"Leg">["to"], "parking" | "parkingSpaces" | "parkingFree"> })[];
};

const IMPACT_RANK: Record<Impact, number> = { none: 0, minor: 1, consider: 2, major: 3 };

export interface ItinerariesProps {
  itineraries: Itinerary[];
  // An Event's title, by id, to name the worst of what's in a way.
  titleOf: (eventId: string) => string | undefined;
  chosen: number;
  // The one that's better today in this mode, and what it avoids.
  better?: { index: number; avoids?: string };
  timeZone: string;
  onChoose: (index: number) => void;
}

// The chosen mode's ways, each with its legs (which line where), times and Impact.
export function Itineraries({ itineraries, chosen, better, titleOf, timeZone, onChoose }: ItinerariesProps) {
  const { t, i18n } = useTranslation();
  const km = (m: number) => t("kilometres", { distance: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(m / 1000) });
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const minutes = (from: string, to: string) => t("minutes", { count: Math.round((Date.parse(to) - Date.parse(from)) / 60_000) });
  const count = (n: number) => new Intl.NumberFormat(i18n.language).format(n);

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="sr-only">{t("routes")}</legend>
      {itineraries.map((itinerary, i) => {
        const legs = itinerary.legs
          .map((leg) => {
            const size = leg.line ? leg.line.name : minutes(leg.start, leg.end);
            const what = `${t(`leg_${leg.mode}`)} ${size}`;
            if (!leg.to?.parking) return what;
            const free = leg.to.parkingFree && freeText({ free: leg.to.parkingFree, spaces: leg.to.parkingSpaces }, count, t);
            return [`${what} ${t("toParking", { name: leg.to.parking })}`, free].filter(Boolean).join(", ");
          })
          .join(", ");
        const times = `${clock.format(new Date(itinerary.start))}–${clock.format(new Date(itinerary.end))}`;
        // The whole way's length, every mode: the legs', when they're known.
        const lengthM = itinerary.legs.every((leg) => leg.distanceM !== undefined) ? itinerary.legs.reduce((sum, leg) => sum + (leg.distanceM ?? 0), 0) : undefined;
        const length = lengthM ? km(lengthM) : undefined;
        const impact = itinerary.impact === "consider" || itinerary.impact === "major" ? itinerary.impact : undefined;
        // What's in the way, and the worst of it: the most that matters, the first met.
        const inWay = itinerary.onTheWay.filter((m) => m.impact === "consider" || m.impact === "major");
        const worst = [...inWay].sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || a.minutes - b.minutes)[0];
        // A big event's crowd: when it's there too, "Concert at the arena, ends about 21:30".
        const worstName = worst && titleOf(worst.eventId);
        const worstTitle = worstName && worst.crowd ? `${worstName}, ${crowdText(worst.crowd, timeZone, t)}` : worstName;
        const inTheWay = worstTitle ? t("inTheWay", { count: inWay.length, what: worstTitle }) : undefined;
        // A park-and-ride way that parks at an almost full car park: why it's worth considering.
        const full = itinerary.legs.find((leg) => leg.mode === "car" && leg.to?.parkingFree?.almostFull)?.to;
        const fullText = full?.parking && full.parkingFree ? t("parkingAlmostFull", { name: full.parking, free: count(full.parkingFree.spaces) }) : undefined;
        const isBetter = better?.index === i;
        const why = isBetter ? [t("betterToday"), ...(better?.avoids ? [t("avoids", { what: better.avoids })] : [])].join(", ") : undefined;
        const label = `${legs.charAt(0).toUpperCase()}${legs.slice(1)}. ${[times, minutes(itinerary.start, itinerary.end), length, impact && t(`impact_${impact}`), inTheWay, fullText, why].filter(Boolean).join(", ")}`;
        return (
          <label
            key={i}
            className="way-option"
          >
            <input type="radio" name="route" className="sr-only" aria-label={label} checked={chosen === i} onChange={() => onChoose(i)} />
            <LegChips legs={itinerary.legs} />
            <span aria-hidden className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">{times}</span>
              <span className="text-(--s-mute)">{minutes(itinerary.start, itinerary.end)}</span>
              {length && <span className="text-(--s-mute)">· {length}</span>}
            </span>
            {impact && (
              <span aria-hidden className="flex min-w-0 items-start gap-1 text-xs text-(--s-mute)">
                <ImpactMark impact={impact} />
                {worstTitle ? (
                  <span className="line-clamp-2">
                    <span className="font-semibold text-(--s-fg) tabular-nums">{inWay.length}</span> · {worstTitle}
                  </span>
                ) : (
                  fullText && <span className="line-clamp-2">{fullText}</span>
                )}
              </span>
            )}
            {why && (
              <span aria-hidden className="flex items-center gap-1 text-xs font-semibold text-(--s-link)">
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

// A way's legs as chips: "walk 4", "tram 2", "P Niittykumpu · 40 free".
export function LegChips({ legs }: { legs: Itinerary["legs"] }) {
  const { t, i18n } = useTranslation();
  const legSize = (leg: Itinerary["legs"][number]) => String(Math.round((Date.parse(leg.end) - Date.parse(leg.start)) / 60_000));
  const count = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  return (
    <span aria-hidden className="flex flex-wrap items-center gap-1">
      {legs.map((leg, j) => {
        const { icon: Icon, colour } = LEG_STYLE[leg.mode];
        const parkAt = leg.to?.parking && (
          <span key={`${j}-p`} className="flex items-center gap-1 bg-(--s-blue) px-1.5 py-0.5 text-xs font-semibold text-(--s-on-blue)">
            P<span className="font-normal">{leg.to.parking}</span>
            {leg.to.parkingFree && (
              <span className={`font-normal ${leg.to.parkingFree.almostFull ? "bg-(--s-amber) px-1 text-(--s-on-amber)" : "opacity-80"}`}>
                · {t("freeShort", { free: count(leg.to.parkingFree.spaces) })}
              </span>
            )}
          </span>
        );
        if (parkAt) {
          return [
            <span key={j} className="flex items-center gap-0.5 text-xs text-(--s-mute)">
              <Icon className="size-3.5" />
              {legSize(leg)}
            </span>,
            parkAt,
          ];
        }
        return leg.line ? (
          <span key={j} className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: colour }}>
            <Icon className="size-3.5" />
            {leg.line.name}
          </span>
        ) : (
          <span key={j} className="flex items-center gap-0.5 text-xs text-(--s-mute)">
            <Icon className="size-3.5" />
            {legSize(leg)}
          </span>
        );
      })}
    </span>
  );
}

export interface ParkingNearProps {
  parking: NonNullable<Schema<"Trip">["parking"]>;
  place: string;
  // Show that pick on the map.
  onPick: (pick: ParkingPick) => void;
  // Without its own heading, under one that already says it.
  untitled?: boolean;
}

export type ParkingPick = NonNullable<Schema<"Trip">["parking"]>["picks"][number];

// Where to leave the car at B: the closest spot, the cheapest and the car park with the most spaces, numbered as on
// the map; then what street parking there is around. Street parking is static data: not whether any space is free
// now. A car park that reports its free spaces says how many. Credited.
export function ParkingNear({ parking: { street, picks, sources }, place, onPick, untitled = false }: ParkingNearProps) {
  const { t, i18n } = useTranslation();
  const count = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const kinds = street
    ? [
        street.paid && t("parkingPaid", { count: street.paid }),
        street.free && t("parkingFree", { count: street.free }),
        street.ev && t("parkingEv", { count: street.ev }),
        street.accessible && t("parkingAccessible", { count: street.accessible }),
      ].filter(Boolean)
    : [];
  return (
    <section aria-label={t("parkingNear", { place })} className="trip-panel">
{!untitled && (
      <h3 className="trip-panel-head">
        <span aria-hidden className="p-mark">
          P
        </span>
        {t("parkingNear", { place })}
      </h3>
      )}
      {picks.length > 0 && (
        <ol>
          {picks.map((pick, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(pick)}
                className="park-pick"
              >
                <span aria-hidden className="p-mark mt-0.5">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="park-pick-name">
                    {[...pick.reasons.map((r) => t(`pick_${r}`)), pick.name ?? t("streetParking")].join(" · ")}
                  </span>
                  <span className="park-pick-sub">
                    {[t("metres", { count: pick.distanceM }), pick.free ? freeText({ free: pick.free, spaces: pick.spaces }, count, t) : parkingDetails(pick, t)].join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {street && (
        <p className="trip-panel-note">
          {[t(street.estimated ? "parkingSpacesAbout" : "parkingSpaces", { count: street.spaces, radius: street.radiusM }), ...kinds].join(" · ")}
        </p>
      )}
      <p className="trip-panel-note">{t("parkingSources", { sources: sources.join(", ") })}</p>
    </section>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

// "541 free of 2,049", "almost full: 6 free of 300"; without the capacity, "6 free".
function freeText({ free, spaces }: { free: NonNullable<ParkingPick["free"]>; spaces?: number }, count: (n: number) => string, t: T): string {
  if (!spaces) return t("freeShort", { free: count(free.spaces) });
  return t(free.almostFull ? "almostFullFreeOf" : "freeOf", { free: count(free.spaces), spaces: count(spaces) });
}

type Spot = Pick<ParkingPick, "spaces" | "estimated" | "perHour" | "paidUntil" | "freeUntil" | "maxStayMin" | "disc"> & {
  cost?: ParkingPick["cost"];
  type?: "ev" | "accessible";
};

// What a pick or a spot on the map offers on arrival: "4 spaces · €4/h until 21:00 · max 1 h"; "about 12 spaces" when
// they're worked out from the street's length (OpenStreetMap).
export function parkingDetails(spot: Spot, t: T): string {
  const cost =
    spot.cost === "free"
      ? spot.freeUntil
        ? t("costFreeUntil", { time: spot.freeUntil })
        : t("costFree")
      : spot.cost === "paid"
        ? [spot.perHour ? t("costPerHour", { price: spot.perHour }) : t("costPaid"), spot.paidUntil && t("paidUntil", { time: spot.paidUntil })].filter(Boolean).join(" ")
        : undefined;
  const stay = spot.maxStayMin
    ? spot.maxStayMin % 60
      ? t("maxStayMinutes", { count: spot.maxStayMin })
      : t("maxStayHours", { count: spot.maxStayMin / 60 })
    : undefined;
  const only = spot.type === "ev" ? t("forEv") : spot.type === "accessible" ? t("forAccessible") : undefined;
  return [t(spot.estimated ? "spacesAbout" : "spaces", { count: spot.spaces }), only, cost, stay, spot.disc && t("parkingDisc")].filter((part): part is string => !!part).join(" · ");
}

export interface HeadsUpProps {
  comingUp: (Pick<Schema<"OnTheWay">, "eventId" | "leg"> & { startsAt: string })[];
  titleOf: (eventId: string) => string | undefined;
  legs: { mode: Schema<"LegMode">; line?: { name: string } }[];
  timeZone: string;
}

// A heads-up: what will be in this way soon, but isn't yet — "From 5.11.2026 · Bridge closed (on the drive)".
export function HeadsUp({ comingUp, titleOf, legs, timeZone }: HeadsUpProps) {
  const { t } = useTranslation();
  const day = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", timeZone });
  if (!comingUp.length) return null;
  return (
    <section aria-label={t("headsUp")} className="trip-panel">
      <h3 className="trip-panel-head">
        <CalendarClock aria-hidden className="size-4 shrink-0" />
        {t("headsUp")}
      </h3>
      <ul className="space-y-1">
        {comingUp.map(({ eventId, leg, startsAt }) => {
          const part = legs[leg];
          const on = part && (part.line ? `${t(`leg_${part.mode}`)} ${part.line.name}` : t(`leg_${part.mode}`));
          return (
            <li key={eventId}>
              <span className="font-semibold">{t("fromDay", { day: day.format(new Date(startsAt)) })}</span> · {titleOf(eventId)}
              {on && <span className="text-(--s-mute)"> ({t("onLeg", { leg: on })})</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
