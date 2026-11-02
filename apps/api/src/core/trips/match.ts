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
  // Where the trip meets it: on the first leg it's on, the point of the route nearest it, and how far into the trip.
  leg: number;
  at: [number, number];
  minutes: number;
}

export interface MatchOptions {
  // The Region's, for reading Events' daily hours; UTC when absent.
  timeZone?: string;
  corridorM?: number;
  // What's going on in this window instead of during the trip (ms since the epoch): what's coming up on the route.
  // Daily hours aren't read: it's a heads-up, not the trip's own minutes.
  window?: { start: number; end: number };
}

export function matchItinerary(itinerary: RoutedItinerary, events: Event[], { timeZone = "UTC", corridorM = CORRIDOR_M, window }: MatchOptions = {}): Match[] {
  const start = window?.start ?? Date.parse(itinerary.start);
  const end = window?.end ?? Date.parse(itinerary.end);
  const moments = window ? undefined : momentsOf(start, end, timeZone);
  const project = projectionAt(itinerary.legs[0]?.from.lat ?? 0);
  const legs = itinerary.legs.map((leg) => ({ leg, shape: shapeOf(project, [leg.geometry.coordinates]) }));

  return events.flatMap((event) => {
    // Its Source says it's in nobody's way.
    if (event.mainlyAffected === "nobody" || !goingOn(event, start, end, moments)) return [];
    // An area or line is placed where it is; a vague Event only by the lines and stops it names.
    const shape = event.where.precision === "vague" ? undefined : eventShape(event, project);
    const matched = legs.flatMap(({ leg, shape: route }, index): (Match["legs"][number] & { index: number })[] => {
      if (leg.line && event.where.lines?.includes(leg.line.id)) return [{ leg, by: "line", index }];
      // An alert that names lines is about those lines: not about others at its stops, or what's near them.
      if (event.where.lines?.length) return [];
      if (leg.stops.some((stop) => event.where.stops?.includes(stop))) return [{ leg, by: "stop", index }];
      const width = leg.mode === "car" ? Math.max(corridorM, CAR_CORRIDOR_M) : corridorM;
      if (shape && !OFF_STREET.has(leg.mode) && distanceM(shape, route) <= width) return [{ leg, by: "corridor", index }];
      return [];
    });
    const first = matched[0];
    if (!first) return [];
    // A line's or stop's alert is met where that leg begins: its stops' places aren't known here.
    const { at, fraction } = first.by === "corridor" && shape ? meeting(shape, first.leg, project) : { at: first.leg.geometry.coordinates[0] ?? [first.leg.from.lon, first.leg.from.lat], fraction: 0 };
    const legStart = Date.parse(first.leg.start);
    const reached = legStart + fraction * (Date.parse(first.leg.end) - legStart);
    return [
      {
        event,
        legs: matched.map(({ leg, by }) => ({ leg, by })),
        leg: first.index,
        at: [at[0] ?? 0, at[1] ?? 0],
        minutes: Math.round((reached - start) / 60_000),
      },
    ];
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
function goingOn({ when, status }: Event, start: number, end: number, moments: ReturnType<typeof momentsOf> | undefined): boolean {
  if (status === "resolved") return false;
  if (Date.parse(when.start) > end || (when.end && Date.parse(when.end) < start)) return false;
  return !when.dailyHours || !moments || moments.some((moment) => withinDailyHours(moment, when.dailyHours));
}

export const RANK: Record<Impact, number> = { none: 0, minor: 1, consider: 2, major: 3 };

// Who is in the way of what, by how a leg is travelled.
const FITS: Partial<Record<LegMode, MainlyAffected[]>> = {
  walk: ["pedestrians", "everyone"],
  bike: ["cyclists", "everyone"],
  car: ["drivers", "everyone"],
};
const TRANSIT_FITS: MainlyAffected[] = ["transit", "everyone"];

// The worst of the matched Events. No delay data yet, so: `major` when a line or stop used is badly disrupted, or
// a road driven is closed; `consider` when it's in the way of those travelling that part (drivers on a drive…)
// and it matters (worth considering itself, or blocking the way); `minor` otherwise — nearby, not in the way.
// A block that doesn't say whom it blocks (most street digs) is taken as the pavement's: in the way on foot or
// by bike only.
export function impactOf(matches: Match[]): Impact {
  return matches.reduce<Impact>((worst, match) => {
    const impact = impactOfMatch(match);
    return RANK[impact] > RANK[worst] ? impact : worst;
  }, "none");
}

export function impactOfMatch({ event, legs }: Pick<Match, "event" | "legs">): Impact {
  const blocks = event.noticeable.includes("blocked");
  const byLineOrStop = legs.some((l) => l.by !== "corridor");
  if (byLineOrStop && (event.severity === "major" || event.noticeable.includes("outage"))) return "major";
  // A closed road on the way: the car has to go round.
  const onCarLeg = legs.some(({ leg }) => leg.mode === "car");
  if (onCarLeg && event.severity === "major" && blocks && event.mainlyAffected !== "unknown") return "major";
  const matters = event.severity === "consider" || event.severity === "major" || blocks;
  const fits = legs.some(({ leg }) => (leg.line ? TRANSIT_FITS : (FITS[leg.mode] ?? [])).includes(event.mainlyAffected));
  const blocksPavement = blocks && event.mainlyAffected === "unknown" && legs.some(({ leg }) => leg.mode === "walk" || leg.mode === "bike");
  return (fits && matters) || blocksPavement ? "consider" : "minor";
}

// Geometry, in metres on a flat projection around the itinerary: fine at the scale of a city.

type Point = [number, number];
interface Shape {
  points: Point[];
  segments: [Point, Point][];
  rings: Point[][];
  bbox: [number, number, number, number];
}

const M_PER_DEG = 111_320;
type Projection = (lonLat: number[]) => Point;
// One scale for the whole itinerary: scaling each point by its own latitude would shift points north of the route east.
const projectionAt = (lat: number): Projection => {
  const scale = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return ([lon, lat]) => [(lon ?? 0) * scale, (lat ?? 0) * M_PER_DEG];
};

function shapeOf(project: Projection, lines: number[][][], rings: number[][][] = []): Shape {
  const projectedLines = [...lines, ...rings].map((line) => line.map(project));
  const points = projectedLines.flat();
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    points,
    segments: projectedLines.flatMap((line) => line.slice(1).map((p, i): [Point, Point] => [line[i]!, p])),
    rings: rings.map((ring) => ring.map(project)),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

function eventShape({ where: { geometry: g } }: Event, project: Projection): Shape {
  switch (g.type) {
    case "Point":
      return shapeOf(project, [[g.coordinates]]);
    case "MultiPoint":
      return shapeOf(project, g.coordinates.map((c) => [c]));
    case "LineString":
      return shapeOf(project, [g.coordinates]);
    case "MultiLineString":
      return shapeOf(project, g.coordinates);
    case "Polygon":
      return shapeOf(project, [], g.coordinates);
    case "MultiPolygon":
      return shapeOf(project, [], g.coordinates.flat());
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

// Where a leg meets an Event: where it first enters or crosses it, else its point nearest it; and how far along the leg.
function meeting(event: Shape, leg: Leg, project: Projection): { at: number[]; fraction: number } {
  const coordinates = leg.geometry.coordinates;
  const route = coordinates.map(project);
  const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i]![0], p[1] - route[i]![1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const along = (i: number, t: number) => (total ? (lengths.slice(0, i).reduce((a, b) => a + b, 0) + t * (lengths[i] ?? 0)) / total : 0);
  const on = (i: number, t: number) => {
    const [ax, ay] = coordinates[i] ?? [0, 0];
    const [bx, by] = coordinates[i + 1] ?? [ax, ay];
    return { at: [ax + t * (bx - ax), ay + t * (by - ay)], fraction: along(i, t) };
  };

  for (let i = 0; i < route.length; i++) {
    if (event.rings.some((ring) => inside(route[i]!, ring))) return on(i, 0);
    if (i === route.length - 1) break;
    const crossings = event.segments.flatMap(([p, q]) => (crosses(p, q, route[i]!, route[i + 1]!) ? [crossingAt(route[i]!, route[i + 1]!, p, q)] : []));
    if (crossings.length) return on(i, Math.min(...crossings));
  }

  let best = { gap: Infinity, i: 0, t: 0 };
  for (const p of event.points) {
    for (let i = 0; i < route.length - 1; i++) {
      const t = towards(p, route[i]!, route[i + 1]!);
      const gap = toSegment(p, route[i]!, route[i + 1]!);
      if (gap < best.gap) best = { gap, i, t };
    }
  }
  for (let i = 0; i < route.length; i++) {
    for (const [r, s] of event.segments) {
      const gap = toSegment(route[i]!, r, s);
      if (gap < best.gap) best = { gap, i, t: 0 };
    }
  }
  return on(best.i, best.t);
}

// How far along a→b the point nearest p is, 0 to 1.
function towards([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  return length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
}

// How far along a→b it crosses p→q, 0 to 1.
function crossingAt([ax, ay]: Point, [bx, by]: Point, [px, py]: Point, [qx, qy]: Point): number {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = qx - px;
  const sy = qy - py;
  return ((px - ax) * sy - (py - ay) * sx) / (rx * sy - ry * sx);
}

function toSegment(p: Point, a: Point, b: Point): number {
  const t = towards(p, a, b);
  return Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])));
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
