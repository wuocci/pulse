import type { GeocodeResult, Impact, Schema, TravelMode } from "@pulse/client";
import { ArrowLeft, BadgeCheck, Bike, Bus, CalendarClock, Car, Footprints, type LucideIcon, OctagonAlert, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddressSearch } from "./AddressSearch.tsx";
import { crowdText, EventList } from "./EventList.tsx";
import type { Pin as PinT } from "./events.ts";
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
      <Button variant="secondary" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t("closeRoute")} onClick={onClose}>
        <ArrowLeft aria-hidden />
      </Button>
      {/* From and To marked as on the map — a ring where you start, a dark dot where you're going — and joined. */}
      <div className="relative min-w-0 flex-1 space-y-2">
        <span aria-hidden className="pointer-events-none absolute top-8 left-[1.1875rem] z-10 h-7 border-l-2 border-dotted border-muted-foreground/50" />
        <AddressSearch
          point={point}
          lang={lang}
          label={t("from")}
          placeholder={t("fromHere")}
          initialText={fromName ?? ""}
          onPick={onFrom}
          leading={<span className="block size-3 rounded-full border-[3px] border-sky-600 bg-background" />}
        />
        <AddressSearch
          point={point}
          lang={lang}
          label={t("to")}
          placeholder={t("toPlaceholder")}
          initialText={toName ?? ""}
          autoFocus={!toName}
          onPick={onTo}
          leading={<span className="block size-3 rounded-full bg-slate-900 ring-2 ring-background dark:bg-slate-100" />}
        />
      </div>
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
    <fieldset className="flex min-w-0 flex-1 gap-1 rounded-3xl border bg-card p-1.5">
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
            className="relative flex min-h-14 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center rounded-2xl px-1 py-1.5 text-muted-foreground outline-none has-checked:bg-muted has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input type="radio" name="mode" className="sr-only" aria-label={label} checked={mode === option} onChange={() => onMode(option)} />
            {(impact || better) && (
              <span aria-hidden className="absolute top-1 right-1 flex items-center gap-0.5 [&_svg]:size-3.5">
                {impact && <ImpactMark impact={impact} />}
                {better && <BadgeCheck className="shrink-0 text-emerald-600" />}
              </span>
            )}
            <Icon aria-hidden className="size-5 shrink-0" />
            <span aria-hidden className="text-[0.6875rem] leading-tight">
              {t(`modeShort_${option}`)}
            </span>
            <span aria-hidden className={`max-w-full truncate text-sm leading-tight ${best ? "font-semibold text-foreground" : ""}`}>
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
    <OctagonAlert aria-hidden className="size-4 shrink-0 text-red-600" />
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
  const legSize = (leg: Itinerary["legs"][number]) => String(Math.round((Date.parse(leg.end) - Date.parse(leg.start)) / 60_000));
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
            className="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-3xl border bg-card p-3 has-checked:border-brand has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input type="radio" name="route" className="sr-only" aria-label={label} checked={chosen === i} onChange={() => onChoose(i)} />
            <span aria-hidden className="flex flex-wrap items-center gap-1">
              {itinerary.legs.map((leg, j) => {
                const { icon: Icon, colour } = LEG_STYLE[leg.mode];
                const parkAt = leg.to?.parking && (
                  <span key={`${j}-p`} className="flex items-center gap-1 rounded bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                    P<span className="font-normal">{leg.to.parking}</span>
                    {leg.to.parkingFree && (
                      <span className={`font-normal ${leg.to.parkingFree.almostFull ? "rounded bg-amber-300 px-1 text-amber-950" : "opacity-80"}`}>
                        · {t("freeShort", { free: count(leg.to.parkingFree.spaces) })}
                      </span>
                    )}
                  </span>
                );
                if (parkAt) {
                  return [
                    <span key={j} className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Icon className="size-3.5" />
                      {legSize(leg)}
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
                    {legSize(leg)}
                  </span>
                );
              })}
            </span>
            <span aria-hidden className="flex items-center gap-2 text-sm">
              <span className="tabular-nums">{times}</span>
              <span className="text-muted-foreground">{minutes(itinerary.start, itinerary.end)}</span>
              {length && <span className="text-muted-foreground">· {length}</span>}
            </span>
            {impact && (
              <span aria-hidden className="flex min-w-0 items-start gap-1 text-xs text-muted-foreground">
                <ImpactMark impact={impact} />
                {worstTitle ? (
                  <span className="line-clamp-2">
                    <span className="font-medium text-foreground tabular-nums">{inWay.length}</span> · {worstTitle}
                  </span>
                ) : (
                  fullText && <span className="line-clamp-2">{fullText}</span>
                )}
              </span>
            )}
            {why && (
              <span aria-hidden className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
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
  // Show that pick on the map.
  onPick: (pick: ParkingPick) => void;
}

export type ParkingPick = NonNullable<Schema<"Trip">["parking"]>["picks"][number];

// Where to leave the car at B: the closest spot, the cheapest and the car park with the most spaces, numbered as on
// the map; then what street parking there is around. Street parking is static data: not whether any space is free
// now. A car park that reports its free spaces says how many. Credited.
export function ParkingNear({ parking: { street, picks, sources }, place, onPick }: ParkingNearProps) {
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
    <section aria-label={t("parkingNear", { place })} className="space-y-2 rounded-lg border p-3 text-sm">
      <h3 className="flex items-center gap-2 font-medium">
        <span aria-hidden className="grid size-5 place-items-center rounded bg-blue-600 text-xs font-bold text-white">
          P
        </span>
        {t("parkingNear", { place })}
      </h3>
      {picks.length > 0 && (
        <ol className="space-y-1.5">
          {picks.map((pick, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(pick)}
                className="-m-1 flex w-[calc(100%+0.5rem)] gap-2 rounded-md p-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">
                    {[...pick.reasons.map((r) => t(`pick_${r}`)), pick.name ?? t("streetParking")].join(" · ")}
                  </span>
                  <span className="block text-muted-foreground">
                    {[t("metres", { count: pick.distanceM }), pick.free ? freeText({ free: pick.free, spaces: pick.spaces }, count, t) : parkingDetails(pick, t)].join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {street && (
        <p className="text-xs text-muted-foreground">
          {[t("parkingSpaces", { count: street.spaces, radius: street.radiusM }), ...kinds].join(" · ")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("parkingSources", { sources: sources.join(", ") })}</p>
    </section>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

// "541 free of 2,049", "almost full: 6 free of 300"; without the capacity, "6 free".
function freeText({ free, spaces }: { free: NonNullable<ParkingPick["free"]>; spaces?: number }, count: (n: number) => string, t: T): string {
  if (!spaces) return t("freeShort", { free: count(free.spaces) });
  return t(free.almostFull ? "almostFullFreeOf" : "freeOf", { free: count(free.spaces), spaces: count(spaces) });
}

type Spot = Pick<ParkingPick, "spaces" | "perHour" | "paidUntil" | "freeUntil" | "maxStayMin" | "disc"> & {
  cost?: ParkingPick["cost"];
  type?: "ev" | "accessible";
};

// What a pick or a spot on the map offers on arrival: "4 spaces · €4/h until 21:00 · max 1 h".
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
  return [t("spaces", { count: spot.spaces }), only, cost, stay, spot.disc && t("parkingDisc")].filter((part): part is string => !!part).join(" · ");
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
    <section aria-label={t("headsUp")} className="space-y-1.5 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
      <h3 className="flex items-center gap-1.5 font-medium">
        <CalendarClock aria-hidden className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        {t("headsUp")}
      </h3>
      <ul className="space-y-1">
        {comingUp.map(({ eventId, leg, startsAt }) => {
          const part = legs[leg];
          const on = part && (part.line ? `${t(`leg_${part.mode}`)} ${part.line.name}` : t(`leg_${part.mode}`));
          return (
            <li key={eventId}>
              <span className="font-medium">{t("fromDay", { day: day.format(new Date(startsAt)) })}</span> · {titleOf(eventId)}
              {on && <span className="text-muted-foreground"> ({t("onLeg", { leg: on })})</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface OnTheWayProps {
  legs: { mode: Schema<"LegMode">; line?: { name: string } }[];
  pins: PinT[];
  selectedId: string | undefined;
  languages: readonly string[];
  timeZone: string;
  onSelect: (id: string) => void;
  // The Event pointed at in the list, so the map can show it; undefined when none.
  onHighlight?: (id: string | undefined) => void;
}

// What's in the chosen way, in the order the trip meets it, under the part of the trip it's on: "Driving",
// "Tram 9"… What's on the whole way (a weather warning over the area) comes first, once: it's not one part's.
type Group = { part: "wholeWay"; pins: PinT[] } | { part: "leg"; leg: number; pins: PinT[] };

export function OnTheWay({ legs, pins: inTheWay, selectedId, languages, timeZone, onSelect, onHighlight }: OnTheWayProps) {
  const { t } = useTranslation();
  const wholeWay = inTheWay.filter((pin) => pin.trip?.wholeWay);
  const byPart = inTheWay
    .filter((pin) => !pin.trip?.wholeWay)
    .reduce<Group[]>((all, pin) => {
      const last = all.at(-1);
      if (last?.part === "leg" && last.leg === pin.trip?.leg) last.pins.push(pin);
      else all.push({ part: "leg", leg: pin.trip?.leg ?? 0, pins: [pin] });
      return all;
    }, []);
  const groups: Group[] = wholeWay.length ? [{ part: "wholeWay", pins: wholeWay }, ...byPart] : byPart;
  const heading = (group: Group) => {
    if (group.part === "wholeWay") return t("wholeWay");
    const leg = legs[group.leg];
    if (!leg) return t("onTheWay");
    if (leg.line) return `${t(`leg_${leg.mode}`).replace(/^./, (c) => c.toUpperCase())} ${leg.line.name}`;
    return leg.mode === "walk" || leg.mode === "bike" || leg.mode === "car" ? t(`group_${leg.mode}`) : t(`leg_${leg.mode}`);
  };
  if (!inTheWay.length) return null;
  return (
    <section aria-label={t("onTheWay")} className="space-y-3">
      {groups.map((group, i) => (
        <div key={i}>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">{heading(group)}</h3>
          <EventList label={heading(group)} pins={group.pins} selectedId={selectedId} languages={languages} timeZone={timeZone} onSelect={onSelect} {...(onHighlight ? { onHighlight } : {})} />
        </div>
      ))}
    </section>
  );
}
