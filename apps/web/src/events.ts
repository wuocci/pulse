import type { Event, Schema } from "@pulse/client";
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
