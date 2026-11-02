import type { Impact, Leg } from "@pulse/schema";
import type { RoutedItinerary, Router, TripRequest } from "../adapters/digitransit-routing.ts";
import { distanceM } from "../adapters/street-parking.ts";
import { RANK } from "./match.ts";

// A detour around what's in a drive's way. Digitransit can't be told to avoid anything, so the drive is steered:
// through a waypoint to either side of the spot, A → waypoint → B, joined into one drive. The detour offered is
// the one with least in its way — by our own Events — arriving at most 5 min after the drive; none if none is
// better.

const LATER_MS = 5 * 60_000;
// Sideways from the spot: left and right of the drive's heading there.
const SIDEWAYS_M = [300, -300, 600, -600];
const M_PER_DEG = 111_320;

export interface Assessed {
  impact: Impact;
  // How many Events are in the way (worth considering or major).
  inTheWay: number;
}

export async function detour(
  router: Router,
  trip: TripRequest,
  drive: RoutedItinerary,
  around: [number, number],
  assess: (itinerary: RoutedItinerary) => Assessed,
): Promise<RoutedItinerary | undefined> {
  const leg = drive.legs.find((l) => l.mode === "car");
  if (!leg) return undefined;
  const tried = await Promise.all(sideways(leg.geometry.coordinates, around).map((waypoint) => via(router, trip, waypoint).catch(() => undefined)));
  const base = assess(drive);
  const latest = Date.parse(drive.end) + LATER_MS;
  const better = tried
    .flatMap((way) => (way && Date.parse(way.end) <= latest ? [{ way, assessed: assess(way) }] : []))
    .filter(({ assessed }) => worse(base, assessed) > 0)
    .sort((a, b) => worse(a.assessed, b.assessed) || Date.parse(a.way.end) - Date.parse(b.way.end));
  return better[0]?.way;
}

// Positive when `a` has more in its way than `b`: by Impact, then by count.
const worse = (a: Assessed, b: Assessed) => RANK[a.impact] - RANK[b.impact] || a.inTheWay - b.inTheWay;

const drivesAllTheWay = ({ legs }: RoutedItinerary) => legs.length > 0 && legs.every((leg) => leg.mode === "car");

async function via(router: Router, trip: TripRequest, waypoint: { lat: number; lon: number }): Promise<RoutedItinerary | undefined> {
  const first = (await router.plan({ ...trip, to: waypoint, directOnly: true })).find(drivesAllTheWay);
  if (!first) return undefined;
  const second = (await router.plan({ ...trip, from: waypoint, departAt: first.end, directOnly: true })).find(drivesAllTheWay);
  if (!second) return undefined;
  return { start: first.start, end: second.end, durationS: Math.round((Date.parse(second.end) - Date.parse(first.start)) / 1000), legs: [joined([...first.legs, ...second.legs])] };
}

// Car legs end to end, as one. A waypoint off the main road leaves a spur — in to it, round, and back out, maybe on
// the other carriageway — which is cut: from where the route first leaves its own way back to where it rejoins it.
function joined(legs: Leg[]): Leg {
  const first = legs[0]!;
  const last = legs.at(-1)!;
  const line = legs.flatMap((leg) => leg.geometry.coordinates).filter((c, i, all) => i === 0 || c[0] !== all[i - 1]![0] || c[1] !== all[i - 1]![1]);
  const waypoint = legs.slice(0, -1).reduce((n, leg) => n + leg.geometry.coordinates.length, 0) - 1;
  const coordinates = withoutSpur(line, Math.min(Math.max(waypoint, 0), line.length - 1));
  return {
    mode: "car",
    from: first.from,
    to: last.to,
    start: first.start,
    end: last.end,
    stops: [],
    distanceM: Math.round(lengthM(coordinates)),
    geometry: { type: "LineString", coordinates },
  };
}

// A spur is short: in to the waypoint and out again, each at most this far.
const SPUR_M = 1500;

// The line without the loop around index `k`: the earliest point before it that the line comes back beside after it.
function withoutSpur<C extends number[]>(line: C[], k: number): C[] {
  const along = line.reduce<number[]>((sums, c, i) => [...sums, i ? sums[i - 1]! + distanceM(at(line[i - 1]!), at(c)) : 0], []);
  for (let i = 0; i < k; i++) {
    if (along[k]! - along[i]! > SPUR_M) continue;
    for (let j = line.length - 1; j > k; j--) {
      if (along[j]! - along[k]! > SPUR_M || j <= i + 1) continue;
      if (toLineM(line[i]!, line.slice(j, j + 2)) <= BESIDE_M) return [...line.slice(0, i + 1), ...line.slice(Math.min(j + 1, line.length - 1))];
    }
  }
  return line;
}

// Two carriageways of one road are drawn this far apart, or less.
const BESIDE_M = 30;
const at = ([lon = 0, lat = 0]: number[]) => ({ lat, lon });
const lengthM = (line: number[][]) => line.slice(1).reduce((sum, c, i) => sum + distanceM(at(c), at(line[i]!)), 0);

// How far a point is from a line, in metres on a flat projection around the point.
function toLineM(point: number[], line: number[][]): number {
  const { lat, lon } = at(point);
  const scale = Math.cos((lat * Math.PI) / 180) * M_PER_DEG;
  const xy = (c: number[]) => [((c[0] ?? 0) - lon) * scale, ((c[1] ?? 0) - lat) * M_PER_DEG] as const;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = xy(line[i]!);
    const [bx, by] = xy(line[i + 1] ?? line[i]!);
    const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = length2 ? Math.max(0, Math.min(1, (-ax * (bx - ax) - ay * (by - ay)) / length2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)));
  }
  return best;
}

// Points to either side of `around`, square to the line's heading at its nearest segment.
function sideways(line: number[][], [lon, lat]: [number, number]): { lat: number; lon: number }[] {
  const scale = Math.cos((lat * Math.PI) / 180);
  const xy = ([x = 0, y = 0]: number[]) => [(x - lon) * scale * M_PER_DEG, (y - lat) * M_PER_DEG] as const;
  let heading: readonly [number, number] = [1, 0];
  let nearest = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy(line[i - 1]!);
    const [bx, by] = xy(line[i]!);
    const length = Math.hypot(bx - ax, by - ay);
    if (!length) continue;
    // How far the spot (the origin here) is from this segment.
    const t = Math.max(0, Math.min(1, (-ax * (bx - ax) - ay * (by - ay)) / (length * length)));
    const gap = Math.hypot(ax + t * (bx - ax), ay + t * (by - ay));
    if (gap < nearest) {
      nearest = gap;
      heading = [(bx - ax) / length, (by - ay) / length];
    }
  }
  const [nx, ny] = [-heading[1], heading[0]];
  return SIDEWAYS_M.map((m) => ({ lat: lat + (ny * m) / M_PER_DEG, lon: lon + (nx * m) / (scale * M_PER_DEG) }));
}
