import type { Impact, Schema, TravelMode } from "@pulse/client";
import type { LatLon } from "./platform.tsx";

// A Trip's one recommendation (design round 2026-11-25): the way to go, why only when it isn't the obvious one, and
// links that hand it to a navigation app.

type Trip = Schema<"Trip">;
type Itinerary = Trip["plans"][number]["itineraries"][number];
export interface Way {
  mode: TravelMode;
  index: number;
}

const RANK: Record<Impact, number> = { none: 0, minor: 1, consider: 2, major: 3 };

// `walkKmh`: how fast you walk, as set; else about 4.5 km/h. `arriveBy`: when the Trip was asked to arrive by
// (epoch ms), instead of leaving at a time.
type Planned = Pick<Trip, "plans"> & { parking?: Trip["parking"]; walkKmh?: number | undefined; arriveBy?: number | undefined };

const ways = (trip: Pick<Trip, "plans">) => trip.plans.flatMap(({ mode, itineraries }) => itineraries.map((itinerary, index) => ({ mode, index, itinerary })));

// Walking from where the car is left, at your speed (else about 75 m a minute): a drive that goes all the way to B still parks, at the
// closest parking there, and you walk the rest. Without it, the car would always look fastest.
const WALK_M_PER_MIN = 75;
export function parkingWalkMin(trip: Planned, mode: TravelMode, itinerary: Itinerary): number {
  const pick = trip.parking?.picks[0];
  if (mode !== "car" || !pick || !itinerary.legs.every((leg) => leg.mode === "car")) return 0;
  return Math.ceil(pick.distanceM / (trip.walkKmh ? (trip.walkKmh * 1000) / 60 : WALK_M_PER_MIN));
}

// When a way gets you to B: on foot, for a drive.
export const arrivalOf = (trip: Planned, mode: TravelMode, itinerary: Itinerary) => Date.parse(itinerary.end) + parkingWalkMin(trip, mode, itinerary) * 60_000;

const changes = (itinerary: Itinerary) => itinerary.legs.filter((leg) => leg.line).length;

// The plain best way, before what's in the way counts. Leaving at a time: the one that gets you to B first; then
// the one that leaves later (a shorter trip); then fewer changes. Arriving by a time, every way arrives in time, so
// arriving first only means waiting at the end: the one that lets you leave latest, then arrives first, then has
// fewer changes. A way that gets you there on foot too late (a drive's walk from parking) comes last.
export function fastestOf(trip: Planned): Way | undefined {
  const { arriveBy } = trip;
  const ranked = ways(trip)
    .map((way) => ({ ...way, leave: Date.parse(way.itinerary.start), arrive: arrivalOf(trip, way.mode, way.itinerary), changes: changes(way.itinerary) }))
    .sort((a, b) =>
      arriveBy === undefined
        ? a.arrive - b.arrive || b.leave - a.leave || a.changes - b.changes
        : Number(a.arrive > arriveBy) - Number(b.arrive > arriveBy) || b.leave - a.leave || a.arrive - b.arrive || a.changes - b.changes,
    );
  return ranked[0] && { mode: ranked[0].mode, index: ranked[0].index };
}

// The way Pulse recommends: the one that's better today when the fastest has something in its way, else the fastest.
export function bestOf(trip: Planned & Pick<Trip, "recommended">): Way | undefined {
  return trip.recommended ?? fastestOf(trip);
}

export const itineraryOf = (trip: Pick<Trip, "plans">, way: Way | undefined): Itinerary | undefined =>
  way && trip.plans.find((p) => p.mode === way.mode)?.itineraries[way.index];

// Why the recommendation isn't the fastest: the worst of what it avoids on the fastest way. Nothing when the
// recommendation is the fastest: the obvious advice needs no reason.
export function avoidedBy(trip: Planned & Pick<Trip, "recommended" | "events">, best: Way | undefined): Trip["events"][number] | undefined {
  const fastest = fastestOf(trip);
  if (!best || !fastest || (best.mode === fastest.mode && best.index === fastest.index)) return undefined;
  const inWay = (itinerary: Itinerary | undefined) => new Set(itinerary?.onTheWay.filter((m) => RANK[m.impact] >= RANK.consider).map((m) => m.eventId));
  const [onFastest, onBest] = [inWay(itineraryOf(trip, fastest)), inWay(itineraryOf(trip, best))];
  return trip.events.filter((e) => onFastest.has(e.id) && !onBest.has(e.id)).sort((a, b) => RANK[severityImpact(b.severity)] - RANK[severityImpact(a.severity)])[0];
}

const severityImpact = (severity: Trip["events"][number]["severity"]): Impact => (severity === "info" ? "none" : severity);

export interface MapsLinks {
  google: string;
  // Only where Apple Maps is the phone's own (iPhone, iPad, Mac).
  apple?: string;
  // The way round something can go to Google Maps as a stop on the way; Apple Maps can't take one.
  steered: boolean;
}

type ParkingPick = NonNullable<Trip["parking"]>["picks"][number];

const GOOGLE_MODE: Record<TravelMode, string> = { transit: "transit", walk: "walking", bike: "bicycling", car: "driving" };
const APPLE_MODE: Partial<Record<TravelMode, string>> = { transit: "r", walk: "w", car: "d" };
const at = ({ lat, lon }: LatLon) => `${lat},${lon}`;

// Where a navigation app should take you, and how: a drive goes to where you'll leave the car (the car park on a
// park-and-ride way, the spot it walks from, else the closest parking at B), through the detour's turn when the way
// steers round something; any other mode goes to B.
export function mapsLinks({
  from,
  to,
  way,
  itinerary,
  plainDrive,
  parking,
  apple,
}: {
  from: LatLon;
  to: LatLon;
  way: Way;
  itinerary: Itinerary;
  // The drive straight there, when `itinerary` may be a way round something.
  plainDrive?: Itinerary | undefined;
  parking?: ParkingPick | undefined;
  apple: boolean;
}): MapsLinks {
  let destination = to;
  const waypoints: LatLon[] = [];
  if (way.mode === "car") {
    const drives = itinerary.legs.filter((leg) => leg.mode === "car");
    const lastDrive = drives.at(-1);
    const drivesAllTheWay = itinerary.legs.every((leg) => leg.mode === "car");
    if (drivesAllTheWay && parking) destination = { lat: parking.lat, lon: parking.lon };
    else if (lastDrive) destination = lastDrive.to;
    const turn = plainDrive && plainDrive !== itinerary && drivesAllTheWay ? turnOf(itinerary, plainDrive) : undefined;
    if (turn) waypoints.push(turn);
  }
  const google = new URL("https://www.google.com/maps/dir/");
  google.searchParams.set("api", "1");
  google.searchParams.set("origin", at(from));
  google.searchParams.set("destination", at(destination));
  google.searchParams.set("travelmode", GOOGLE_MODE[way.mode]);
  if (waypoints.length) google.searchParams.set("waypoints", waypoints.map(at).join("|"));
  const links: MapsLinks = { google: google.toString(), steered: waypoints.length > 0 };
  if (apple) {
    const url = new URL("https://maps.apple.com/");
    url.searchParams.set("saddr", at(from));
    url.searchParams.set("daddr", at(destination));
    const flag = APPLE_MODE[way.mode];
    if (flag) url.searchParams.set("dirflg", flag);
    links.apple = url.toString();
  }
  return links;
}

// Where a way round leaves the plain drive furthest behind: a stop on the way that makes a navigation app take it.
function turnOf(way: Itinerary, plain: Itinerary): LatLon | undefined {
  const line = (itinerary: Itinerary) => itinerary.legs.flatMap((leg) => leg.geometry.coordinates);
  const plainLine = line(plain);
  if (!plainLine.length) return undefined;
  let furthest: { d: number; point: number[] } | undefined;
  for (const point of line(way)) {
    const d = Math.min(...plainLine.map((p) => Math.hypot((p[0]! - point[0]!) * Math.cos((point[1]! * Math.PI) / 180), p[1]! - point[1]!)));
    if (!furthest || d > furthest.d) furthest = { d, point };
  }
  // Under about 50 m from the plain drive: the same way, not a way round.
  if (!furthest || furthest.d < 0.00045) return undefined;
  return { lat: furthest.point[1]!, lon: furthest.point[0]! };
}

// Apple Maps is offered where it's the device's own.
export const onApple = (userAgent: string) => /iPhone|iPad|Macintosh/.test(userAgent);

// A way step by step, for its accordion: where you start, every stop you get on or off at (a car park on a
// park-and-ride way), and where you arrive, each with its time; between them, how you go and for how long.
type LegOf = Itinerary["legs"][number];
export type Step =
  | { kind: "start" | "end" | "park" | "board" | "off"; time: number; name: string; at: LatLon; line?: { name: string; mode: LegOf["mode"] } }
  | { kind: "move"; mode: LegOf["mode"]; minutes: number; stops: number };

// A drive that goes all the way parks at `parking` (the closest parking at B) and walks the rest: both are steps.
export function stepsOf(itinerary: Itinerary, names: { from: string; to: string; parking?: string }, arrival: number, parking?: ParkingPick): Step[] {
  const { legs } = itinerary;
  const first = legs[0];
  const last = legs.at(-1);
  if (!first || !last) return [];
  const minutes = (leg: LegOf) => Math.max(1, Math.round((Date.parse(leg.end) - Date.parse(leg.start)) / 60_000));
  const steps: Step[] = [{ kind: "start", time: Date.parse(itinerary.start), name: names.from, at: first.from }];
  legs.forEach((leg, i) => {
    if (leg.line) {
      steps.push({ kind: "board", time: Date.parse(leg.start), name: leg.from.name, at: leg.from, line: { name: leg.line.name, mode: leg.mode } });
      // The stops a ride passes, without the one it starts from.
      steps.push({ kind: "move", mode: leg.mode, minutes: minutes(leg), stops: Math.max(0, leg.stops.length - 1) });
      // Off where the next ride doesn't pick you straight up, and never at the very end: that's where you arrive.
      const next = legs[i + 1];
      if (next && !(next.line && next.from.name === leg.to.name)) steps.push({ kind: "off", time: Date.parse(leg.end), name: leg.to.name, at: leg.to });
      return;
    }
    steps.push({ kind: "move", mode: leg.mode, minutes: minutes(leg), stops: 0 });
    if (leg.to.parking && leg !== last) steps.push({ kind: "park", time: Date.parse(leg.end), name: leg.to.parking, at: leg.to });
  });
  const walk = Math.round((arrival - Date.parse(last.end)) / 60_000);
  if (parking && last.mode === "car" && walk > 0) {
    steps.push({ kind: "park", time: Date.parse(last.end), name: parking.name ?? names.parking ?? "", at: parking });
    steps.push({ kind: "move", mode: "walk", minutes: walk, stops: 0 });
  }
  steps.push({ kind: "end", time: arrival, name: names.to, at: last.to });
  return steps;
}
