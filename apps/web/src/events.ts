import type { Event, Impact, Schema } from "@pulse/client";
import type { LatLon } from "./platform.tsx";

// How Events become what the map shows: where their pins go, what colour, in what order, and the status line.

type Position = [number, number];
type Geometry = Schema<"Geometry">;

// Severity as the map's three colours: nothing to worry about, worth considering, major.
export type Tone = "quiet" | "consider" | "major";

export function toneOf({ severity }: Event): Tone {
  return severity === "major" ? "major" : severity === "consider" ? "consider" : "quiet";
}

const position = (c: number[]): Position => [c[0] ?? 0, c[1] ?? 0];

// The middle of a ring's bounding box: good enough to put a pin on a works area.
function middleOf(ring: number[][]): Position {
  const lons = ring.map((c) => c[0] ?? 0);
  const lats = ring.map((c) => c[1] ?? 0);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += (ring[i]![0] ?? 0) * (ring[i + 1]![1] ?? 0) - (ring[i + 1]![0] ?? 0) * (ring[i]![1] ?? 0);
  return Math.abs(sum / 2);
}

function positionsOf(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case "Point":
      return [position(geometry.coordinates)];
    case "MultiPoint":
      return geometry.coordinates.map(position);
    case "LineString":
      return geometry.coordinates.length ? [position(geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]!)] : [];
    case "MultiLineString": {
      const line = geometry.coordinates[0] ?? [];
      return line.length ? [position(line[Math.floor(line.length / 2)]!)] : [];
    }
    case "Polygon":
      return geometry.coordinates[0] ? [middleOf(geometry.coordinates[0])] : [];
    case "MultiPolygon": {
      const outer = geometry.coordinates.map((polygon) => polygon[0] ?? []).filter((ring) => ring.length);
      const largest = outer.reduce<number[][] | undefined>((best, ring) => (!best || ringArea(ring) > ringArea(best) ? ring : best), undefined);
      return largest ? [middleOf(largest)] : [];
    }
  }
}

// Where an Event's pins go: one per stop, otherwise one. A vague Event (e.g. an alert for the whole Region) gets
// none: it isn't drawn as if it were somewhere in particular.
export function pinsFor(event: Event): Position[] {
  return event.where.precision === "vague" ? [] : positionsOf(event.where.geometry);
}

export interface Pin {
  key: string;
  event: Event;
  lngLat: Position;
  distanceM: number;
  // On a Trip: where the trip meets it — which leg, how many minutes in, or the whole way — and how much it matters
  // for the trip.
  trip?: { leg: number; minutes: number; impact: Impact; wholeWay?: boolean; crowd?: Schema<"OnTheWay">["crowd"] };
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function distanceM(from: LatLon, [lon, lat]: Position): number {
  const x = toRad(lon - from.lon) * Math.cos(toRad((lat + from.lat) / 2));
  const y = toRad(lat - from.lat);
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
}

// Every pin, nearest first: the order keyboard and screen-reader users tab through them.
export function nearestFirst(events: Event[], here: LatLon): Pin[] {
  return events
    .flatMap((event) => pinsFor(event).map((lngLat, i) => ({ key: `${event.id}#${i}`, event, lngLat, distanceM: distanceM(here, lngLat) })))
    .sort((a, b) => a.distanceM - b.distanceM);
}

// What's in a Trip's way (worth considering or major), pinned where the trip meets it, in the order it does. What's
// only nearby isn't shown: it doesn't get in the way.
export function tripPins(onTheWay: (Omit<Schema<"OnTheWay">, "at"> & { at: number[] })[], events: Event[]): Pin[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const pins = onTheWay.flatMap(({ eventId, at, leg, minutes, impact, wholeWay, crowd }): Pin[] => {
    const event = byId.get(eventId);
    return event ? [{ key: `${eventId}#trip`, event, lngLat: [at[0] ?? 0, at[1] ?? 0], distanceM: 0, trip: { leg, minutes, impact, wholeWay, crowd } }] : [];
  });
  return pins.filter((pin) => pin.trip?.impact === "consider" || pin.trip?.impact === "major");
}

// Whether an Event is for My area. A line's alert placed nowhere isn't: it names lines but no stop the map can
// place (HSL's Majvik stop, in Sipoo, only in its text), so it is about those lines and is for Trips, not for
// everyone in the Region. An alert that names no line or stop, like a strike, is region-wide.
export function inMyArea({ where }: Event): boolean {
  return where.precision !== "vague" || !(where.lines?.length || where.stops?.length);
}

// What isn't anywhere in particular (e.g. an HSL alert for the whole Region): no pin, but the chip above the map
// counts it, so it isn't missed.
export function regionWide(events: Event[]): Event[] {
  return events.filter((e) => e.where.precision === "vague");
}

const M_PER_DEG = 111_320;
// An area or line this big isn't drawn: shading half the map (a weather warning over the county) says nothing.
const OUTLINE_MAX_M = 5000;

// The shape to draw under an Event's pin: its area lightly shaded, or its line along its path. None for a point,
// a vague Event, or one too big to draw.
export function outlineOf({ where }: Event): Geometry | undefined {
  const { geometry, precision } = where;
  if (precision === "vague" || geometry.type === "Point" || geometry.type === "MultiPoint") return undefined;
  const all = (geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "Polygon" || geometry.type === "MultiLineString" ? geometry.coordinates : geometry.coordinates.flat()).flat();
  if (!all.length) return undefined;
  const lons = all.map((c) => c[0] ?? 0);
  const lats = all.map((c) => c[1] ?? 0);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const width = (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const height = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG;
  return Math.hypot(width, height) <= OUTLINE_MAX_M ? geometry : undefined;
}

// A circle of `radiusM` around the point, as a ring of [lon, lat]: how far the map looks.
export function circleAround({ lat, lon }: LatLon, radiusM: number, steps = 64): Position[] {
  const dLat = radiusM / M_PER_DEG;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / steps;
    return [lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)];
  });
}

// Pins closer than `px` on screen, grouped: each pin joins the first group whose first pin is that close, in the
// order given (nearest first), so a group sits where its nearest pin is.
export function groupNear<T extends { x: number; y: number }>(points: T[], px: number): T[][] {
  const groups: T[][] = [];
  for (const point of points) {
    const group = groups.find(([first]) => Math.hypot(first!.x - point.x, first!.y - point.y) < px);
    if (group) group.push(point);
    else groups.push([point]);
  }
  return groups;
}

// Pins at one spot (a stop's alerts, a venue's events): zooming in won't part them.
export function sameSpot(pins: Pick<Pin, "lngLat">[]): boolean {
  const [first] = pins;
  return !!first && pins.every(({ lngLat }) => Math.abs(lngLat[0] - first.lngLat[0]) < 1e-5 && Math.abs(lngLat[1] - first.lngLat[1]) < 1e-5);
}

const getsInTheWay = ({ severity }: Event) => severity === "consider" || severity === "major";

// Home's sections. `atTheTime`: what's going on at the chosen moment (now, or a picked time); `soon`: what starts
// in the next two weeks. Both leave out what is in nobody's way and what isn't for My area.
// - In your way: worth considering or major, region-wide notices first (they have no distance), then nearest.
// - Around you: the rest you'd notice on site (noise, crowds…), nearest first.
// - Coming up: worth considering or major and not going on at the time already, soonest first.
export interface Sections {
  inYourWay: Event[];
  aroundYou: Event[];
  comingUp: Event[];
}

export function sectionsOf(atTheTime: Event[], soon: Event[], here: LatLon): Sections {
  const forYou = (e: Event) => e.mainlyAffected !== "nobody" && inMyArea(e);
  const now = atTheTime.filter(forYou);
  const nearest = (events: Event[]) => {
    const order = new Map<string, number>();
    nearestFirst(events, here).forEach((pin, i) => order.has(pin.event.id) || order.set(pin.event.id, i));
    const rank = (e: Event) => (e.where.precision === "vague" ? -1 : (order.get(e.id) ?? Infinity));
    return [...events].sort((a, b) => rank(a) - rank(b));
  };
  const going = new Set(now.map((e) => e.id));
  return {
    inYourWay: nearest(now.filter(getsInTheWay)),
    aroundYou: nearest(now.filter((e) => !getsInTheWay(e) && e.noticeable.length > 0)),
    comingUp: soon
      .filter((e) => forYou(e) && getsInTheWay(e) && !going.has(e.id))
      .sort((a, b) => Date.parse(a.when.start) - Date.parse(b.when.start)),
  };
}

// The summary line: how many things are in your way at the time, and how many of them are major. Never "all
// clear": emergency call-outs aren't covered.
export type Summary = { key: "summaryNothing" } | { key: "summaryInWay"; count: number; major: number };

export function summaryOf({ inYourWay }: Sections): Summary {
  if (!inYourWay.length) return { key: "summaryNothing" };
  return { key: "summaryInWay", count: inYourWay.length, major: inYourWay.filter((e) => e.severity === "major").length };
}

// A picked time as the time control shows it: "2026-12-12T18:00" → "12.12.2026 18.00".
export function pickedText(local: string): string {
  const [date = "", time = ""] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h = "0", min = "00"] = time.split(":");
  return `${d}.${m}.${y} ${Number(h)}.${min}`;
}

// An Event's text in the first of the reader's languages it has, else any it has.
export function textIn(text: Record<string, string>, languages: readonly string[]): string {
  return languages.map((l) => text[l]).find(Boolean) ?? Object.values(text)[0] ?? "";
}

export type When = (
  | { key: "whenUntil" | "whenEnded"; end: string }
  | { key: "whenOngoing" }
  | { key: "whenFrom"; start: string }
  | { key: "whenFromTo"; start: string; end: string }
  | { key: "whenToday"; from: string; to: string }
  | { key: "whenOnDay"; day: string; from: string; to: string }
) & { hours?: Hours };

export type Hours = { key: "hoursDaily" | "hoursWeekdays"; from: string; to: string } | { key: "hoursDays"; days: string; from: string; to: string };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

// "07:00" → "7.00": clock times the Finnish way.
const clockOf = (hhmm: string) => {
  const [h = "0", m = "00"] = hhmm.split(":");
  return `${Number(h)}.${m}`;
};

function hoursOf(daily: Event["when"]["dailyHours"]): Hours | undefined {
  if (!daily) return undefined;
  const [from, to] = [clockOf(daily.from), clockOf(daily.to)];
  const { days } = daily;
  if (!days) return { key: "hoursDaily", from, to };
  if (days.length === WEEKDAYS.length && WEEKDAYS.every((d) => days.includes(d as (typeof days)[number]))) {
    return { key: "hoursWeekdays", from, to };
  }
  return { key: "hoursDays", days: days.map((d) => d[0]!.toUpperCase() + d.slice(1)).join(", "), from, to };
}

// When an Event is, in the Region's time zone, with dates in Finnish numbers and always the year: "Now – 31.12.2027",
// "1.12.2026 – 14.12.2026", "Today 18.00–21.30". Times only for what starts and ends on one day; a longer one's
// daily hours come as `hours`.
export function whenOf({ when, status }: Event, timeZone: string, now: Date): When {
  const day = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", timeZone });
  const clock = new Intl.DateTimeFormat("fi-FI", { hour: "numeric", minute: "2-digit", timeZone });
  const date = (iso: string) => day.format(new Date(iso));
  const time = (iso: string) => clock.format(new Date(iso));
  const oneDay = when.end !== undefined && date(when.start) === date(when.end);
  const hours = oneDay ? undefined : hoursOf(when.dailyHours);
  const withHours = <T extends object>(w: T) => (hours ? { ...w, hours } : w);

  if (status === "resolved") return withHours({ key: "whenEnded" as const, end: date(when.end ?? now.toISOString()) });
  if (oneDay && when.end) {
    const [from, to] = [time(when.start), time(when.end)];
    return date(when.start) === date(now.toISOString()) ? { key: "whenToday", from, to } : { key: "whenOnDay", day: date(when.start), from, to };
  }
  if (new Date(when.start) > now) {
    return withHours(when.end ? { key: "whenFromTo" as const, start: date(when.start), end: date(when.end) } : { key: "whenFrom" as const, start: date(when.start) });
  }
  return withHours(when.end ? { key: "whenUntil" as const, end: date(when.end) } : { key: "whenOngoing" as const });
}

// What a card calls an Event: the Source's title split into what and where ("Bridge closed" + "Hopeasalmentien
// silta"; the Adapters build titles "what · where"), and for a dig its kind of work, which the card says in plain
// words in place of the Source's "Excavation". A permit's title says only its category ("Traffic arrangement"), so
// one without a kind of work says what it is with its own text's first sentence (`what`): "Tilapäinen reitti
// kävelijöille". A public event's text describes it at length, so its title, its name, stays.
export function plainTitle(
  event: Event,
  languages: readonly string[],
): { title: string; address?: string; workType?: NonNullable<Event["workType"]>; what?: string } {
  const source = textIn(event.title, languages);
  const [head = source, ...rest] = source.split(" · ");
  const address = rest.length ? rest.join(" · ") : undefined;
  const what = address && !event.workType && (event.kind === "works" || event.kind === "closure") ? firstSentence(textIn(event.originalText ?? {}, languages)) : undefined;
  return {
    title: address ? head : source,
    ...(address ? { address } : {}),
    ...(event.workType ? { workType: event.workType } : {}),
    ...(what ? { what } : {}),
  };
}

// A permit's opening words that only say who reserves the space: "Työstä vastaava varaa tilaa tilapäisille
// liikennemerkeille" says what with its last words.
const RESERVES = /^(työstä vastaava|päätöksensaaja|luvansaaja|hakija)\s+varaa\s+tilaa\s+/i;

// A text's first sentence, without its full stop or who reserves the space: up to the first line break or ". ".
// Notes the Source adds below it ("LISÄYS 26.1.2021: …") are left out with the rest.
function firstSentence(text: string): string | undefined {
  const line = text.trim().split("\n")[0] ?? "";
  const sentence = (line.split(/\.\s/)[0] ?? "").replace(/\s*\.?\s*$/, "").replace(RESERVES, "").trim();
  return sentence.length >= 4 ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : undefined;
}

// The value a row on Home leads with, at its right: when what's in your way ends ("until 1.4.2027", "until 18.00"),
// or when what's coming up starts ("Tomorrow", "In 3 days"), counted in days on the Region's calendar.
export type RowValue =
  | { key: "rowUntil"; value: string }
  | { key: "rowNoEnd" }
  | { key: "rowToday" | "rowTomorrow" }
  | { key: "rowInDays"; count: number };

export function untilOf(event: Event, timeZone: string, now: Date): RowValue {
  const when = whenOf(event, timeZone, now);
  if ("to" in when) return { key: "rowUntil", value: when.to };
  if ("end" in when) return { key: "rowUntil", value: when.end };
  return { key: "rowNoEnd" };
}

export function startsOf({ when }: Event, timeZone: string, now: Date): RowValue {
  const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  const days = Math.round((Date.parse(day.format(new Date(when.start))) - Date.parse(day.format(now))) / 86_400_000);
  if (days <= 0) return { key: "rowToday" };
  return days === 1 ? { key: "rowTomorrow" } : { key: "rowInDays", count: days };
}
