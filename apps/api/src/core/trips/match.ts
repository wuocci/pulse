import type { Event, Impact, Leg, LegMode, MainlyAffected } from "@pulse/schema";
import type { RoutedItinerary } from "../adapters/digitransit-routing.ts";
import { localClock, withinDailyHours } from "../events/hours.ts";

// Which Events are on an itinerary, and how much they matter for it (Impact). PRD #34:
// an Event is on it when it shares a line or stop with a transit leg, or lies within CORRIDOR_M of a street leg,
// and it's going on during the trip.

export const CORRIDOR_M = 30;
// A motorway's two carriageways are drawn apart, and road works are drawn on either: a car leg looks wider.
export const CAR_CORRIDOR_M = 50;

// Off the street: works beside the track or the fairway don't touch the ride, only its own line and stops do.
const OFF_STREET = new Set<LegMode>(["rail", "subway", "ferry"]);

export interface Match {
  event: Event;
  legs: { leg: Leg; by: "line" | "stop" | "corridor" }[];
}

export interface MatchOptions {
  // The Region's, for reading Events' daily hours; UTC when absent.
  timeZone?: string;
  corridorM?: number;
}

export function matchItinerary(itinerary: RoutedItinerary, events: Event[], { timeZone = "UTC", corridorM = CORRIDOR_M }: MatchOptions = {}): Match[] {
  const start = Date.parse(itinerary.start);
  const end = Date.parse(itinerary.end);
  const moments = momentsOf(start, end, timeZone);
  const legs = itinerary.legs.map((leg) => ({ leg, shape: shapeOf([leg.geometry.coordinates]) }));

  return events.flatMap((event) => {
    if (!goingOn(event, start, end, moments)) return [];
    // An area or line is placed where it is; a vague Event only by the lines and stops it names.
    const shape = event.where.precision === "vague" ? undefined : eventShape(event);
    const matched = legs.flatMap(({ leg, shape: route }): Match["legs"] => {
      if (leg.line && event.where.lines?.includes(leg.line.id)) return [{ leg, by: "line" }];
      if (leg.stops.some((stop) => event.where.stops?.includes(stop))) return [{ leg, by: "stop" }];
      const width = leg.mode === "car" ? Math.max(corridorM, CAR_CORRIDOR_M) : corridorM;
      if (shape && !OFF_STREET.has(leg.mode) && distanceM(shape, route) <= width) return [{ leg, by: "corridor" }];
      return [];
    });
    return matched.length ? [{ event, legs: matched }] : [];
  });
}

const SAMPLE_MS = 5 * 60_000;

// The trip's local clock every few minutes, start and end included: enough to tell whether hours overlap it.
function momentsOf(start: number, end: number, timeZone: string) {
  const times = [];
  for (let t = start; t < end; t += SAMPLE_MS) times.push(t);
  times.push(end);
  return times.map((t) => localClock(new Date(t), timeZone));
}

// Going on during the trip: in its time window and, if the Source gives daily hours, within them at some point.
// Only the Source's own hours: a dig blocks the street at night too, whatever the kind's usual working hours.
function goingOn({ when, status }: Event, start: number, end: number, moments: ReturnType<typeof momentsOf>): boolean {
  if (status === "resolved") return false;
  if (Date.parse(when.start) > end || (when.end && Date.parse(when.end) < start)) return false;
  return !when.dailyHours || moments.some((moment) => withinDailyHours(moment, when.dailyHours));
}

export const RANK: Record<Impact, number> = { none: 0, minor: 1, consider: 2, major: 3 };

// Who is in the way of what, by how a leg is travelled.
const FITS: Partial<Record<LegMode, MainlyAffected[]>> = {
  walk: ["pedestrians", "everyone"],
  bike: ["cyclists", "everyone"],
  car: ["drivers", "everyone"],
};
const TRANSIT_FITS: MainlyAffected[] = ["transit", "everyone"];

// The worst of the matched Events. No delay data yet, so: `major` when a line or stop used is badly disrupted;
// `consider` when the Event is in the way of how that part is travelled, or blocks the way; `minor` otherwise.
export function impactOf(matches: Match[]): Impact {
  return matches.reduce<Impact>((worst, match) => {
    const impact = impactOfMatch(match);
    return RANK[impact] > RANK[worst] ? impact : worst;
  }, "none");
}

function impactOfMatch({ event, legs }: Match): Impact {
  const byLineOrStop = legs.some((l) => l.by !== "corridor");
  if (byLineOrStop && (event.severity === "major" || event.noticeable.includes("outage"))) return "major";
  // A closed road on the way: the car has to go round.
  const onCarLeg = legs.some(({ leg }) => leg.mode === "car");
  if (onCarLeg && event.severity === "major" && event.noticeable.includes("blocked")) return "major";
  const fits = legs.some(({ leg }) => (leg.line ? TRANSIT_FITS : (FITS[leg.mode] ?? [])).includes(event.mainlyAffected));
  return fits || event.noticeable.includes("blocked") ? "consider" : "minor";
}

// Geometry, in metres on a flat projection around the Region: fine at the scale of a city.

type Point = [number, number];
interface Shape {
  points: Point[];
  segments: [Point, Point][];
  rings: Point[][];
  bbox: [number, number, number, number];
}

const M_PER_DEG = 111_320;
const toMetres = ([lon, lat]: number[]): Point => [(lon ?? 0) * M_PER_DEG * Math.cos(((lat ?? 0) * Math.PI) / 180), (lat ?? 0) * M_PER_DEG];

function shapeOf(lines: number[][][], rings: number[][][] = []): Shape {
  const projectedLines = [...lines, ...rings].map((line) => line.map(toMetres));
  const points = projectedLines.flat();
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    points,
    segments: projectedLines.flatMap((line) => line.slice(1).map((p, i): [Point, Point] => [line[i]!, p])),
    rings: rings.map((ring) => ring.map(toMetres)),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

function eventShape({ where: { geometry: g } }: Event): Shape {
  switch (g.type) {
    case "Point":
      return shapeOf([[g.coordinates]]);
    case "MultiPoint":
      return shapeOf(g.coordinates.map((c) => [c]));
    case "LineString":
      return shapeOf([g.coordinates]);
    case "MultiLineString":
      return shapeOf(g.coordinates);
    case "Polygon":
      return shapeOf([], g.coordinates);
    case "MultiPolygon":
      return shapeOf([], g.coordinates.flat());
  }
}

// 0 when they touch or the route runs inside an area; otherwise the shortest gap between them.
function distanceM(a: Shape, route: Shape): number {
  const [ax0, ay0, ax1, ay1] = a.bbox;
  const [bx0, by0, bx1, by1] = route.bbox;
  const gap = Math.max(ax0 - bx1, bx0 - ax1, ay0 - by1, by0 - ay1, 0);
  if (gap > CORRIDOR_M * 10) return gap;

  if (route.points.some((p) => a.rings.some((ring) => inside(p, ring)))) return 0;
  if (a.segments.some(([p, q]) => route.segments.some(([r, s]) => crosses(p, q, r, s)))) return 0;

  let best = Infinity;
  for (const p of a.points) for (const [r, s] of route.segments) best = Math.min(best, toSegment(p, r, s));
  for (const p of route.points) for (const [r, s] of a.segments) best = Math.min(best, toSegment(p, r, s));
  // A route of one point (no segments) against a point.
  if (best === Infinity) for (const p of a.points) for (const q of route.points) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
}

function toSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const side = ([ax, ay]: Point, [bx, by]: Point, [cx, cy]: Point) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

function crosses(p: Point, q: Point, r: Point, s: Point): boolean {
  return side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0;
}

function inside([x, y]: Point, ring: Point[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}
