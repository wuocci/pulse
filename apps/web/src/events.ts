import type { Event, Impact, Schema } from "@pulse/client";
import type { LatLon } from "./platform.tsx";

// How Events become what the map shows: where their pins go, what colour, in what order, and the status line.

// The time switch: what's going on right now, or now and the next two weeks.
export type Time = "now" | "14d";

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
  trip?: { leg: number; minutes: number; impact: Impact; wholeWay?: boolean };
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
  const pins = onTheWay.flatMap(({ eventId, at, leg, minutes, impact, wholeWay }): Pin[] => {
    const event = byId.get(eventId);
    return event ? [{ key: `${eventId}#trip`, event, lngLat: [at[0] ?? 0, at[1] ?? 0], distanceM: 0, trip: { leg, minutes, impact, wholeWay } }] : [];
  });
  return pins.filter((pin) => pin.trip?.impact === "consider" || pin.trip?.impact === "major");
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

export type Status =
  | { key: "statusClearNow" | "statusClearSoon" }
  | { key: "statusNow" | "statusSoon"; count: number; major: number };

// The status line: the gist in words. Counts what is on the map and still going on.
export function statusOf(events: Event[], time: Time): Status {
  const counted = events.filter((e) => e.status !== "resolved" && e.where.precision !== "vague");
  if (!counted.length) return { key: time === "now" ? "statusClearNow" : "statusClearSoon" };
  return { key: time === "now" ? "statusNow" : "statusSoon", count: counted.length, major: counted.filter((e) => e.severity === "major").length };
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
) & { hours?: Hours };

export type Hours = { key: "hoursDaily" | "hoursWeekdays"; from: string; to: string } | { key: "hoursDays"; days: string; from: string; to: string };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

function hoursOf(daily: Event["when"]["dailyHours"]): Hours | undefined {
  if (!daily) return undefined;
  const { from, to, days } = daily;
  if (!days) return { key: "hoursDaily", from, to };
  if (days.length === WEEKDAYS.length && WEEKDAYS.every((d) => days.includes(d as (typeof days)[number]))) {
    return { key: "hoursWeekdays", from, to };
  }
  return { key: "hoursDays", days: days.map((d) => d[0]!.toUpperCase() + d.slice(1)).join(", "), from, to };
}

// When an Event is, in plain words and in the Region's time zone: "until Fri 13 Nov", "ended Thu 29 Oct"…
export function whenOf({ when, status }: Event, timeZone: string, now: Date): When {
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
  const date = (iso: string) => day.format(new Date(iso)).replace(",", "");
  const hours = hoursOf(when.dailyHours);
  const withHours = <T extends object>(w: T) => (hours ? { ...w, hours } : w);

  if (status === "resolved") return withHours({ key: "whenEnded" as const, end: date(when.end ?? now.toISOString()) });
  if (new Date(when.start) > now) {
    return withHours(when.end ? { key: "whenFromTo" as const, start: date(when.start), end: date(when.end) } : { key: "whenFrom" as const, start: date(when.start) });
  }
  return withHours(when.end ? { key: "whenUntil" as const, end: date(when.end) } : { key: "whenOngoing" as const });
}
