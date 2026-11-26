import type { RoutedItinerary, Router, TripRequest } from "../adapters/digitransit-routing.ts";
import { distanceM } from "../adapters/street-parking.ts";
import type { ParkingFinder } from "./routes.ts";
import { within } from "./within.ts";

// A car Trip: the drive, then the park-and-ride ways worth offering beside it — those that park towards B and
// arrive at most 10 min after the drive. When no car gets to B itself (a park, a pedestrian street: its point is
// off the roads), the drive goes as near as it can and walks the rest, as a driver would: to the best street
// parking near B when there's any, else to where a car first gets on the way out of B. Without any drive there's
// nothing to weigh park-and-ride against: none is offered.
// Digitransit's planner parks at a full car park as readily as at an empty one (checked 2026-11-06: all five ways
// from beside a full one parked there), so the ways that park where there's room come first.

const PARK_AND_RIDE_LATER_MS = 10 * 60_000;
// The way out of B: a walk this far towards A, tried for a car this far along it.
const WAY_OUT_M = 1000;
const TRIED_ALONG_M = [100, 250, 500];
// Driving near B and walking is a fallback: what isn't found in this time isn't offered. Tried one spot after
// another, it took 40 s (2026-11-24).
const DRIVE_NEAR_BUDGET_MS = 5000;

const drivesAllTheWay = ({ legs }: RoutedItinerary) => legs.length > 0 && legs.every((leg) => leg.mode === "car");

export async function planCar(router: Router, parking: ParkingFinder | undefined, trip: TripRequest): Promise<RoutedItinerary[]> {
  const ways = await router.plan(trip);
  const drive = ways.find(drivesAllTheWay) ?? (await within(DRIVE_NEAR_BUDGET_MS, driveAndWalk(router, parking, trip)));
  if (!drive) return [];
  const parkAndRide = ways.filter((way) => !drivesAllTheWay(way) && worthIt(way, trip, drive));
  return [drive, ...parkAndRide.filter((way) => !parksAlmostFull(way)), ...parkAndRide.filter(parksAlmostFull)];
}

// Parks at a car park that's almost full: the way may not work out (a full one breaks the trip).
export const parksAlmostFull = ({ legs }: Pick<RoutedItinerary, "legs">) => legs.some((leg) => leg.mode === "car" && !!leg.to.parkingFree?.almostFull);

function worthIt({ legs, end }: RoutedItinerary, { from, to }: TripRequest, drive: RoutedItinerary): boolean {
  const parking = legs[0]?.mode === "car" ? legs[0].to : undefined;
  if (!parking?.parking || distanceM(parking, to) >= distanceM(from, to)) return false;
  return Date.parse(end) <= Date.parse(drive.end) + PARK_AND_RIDE_LATER_MS;
}

// Drive as near B as a car gets, then walk to B. The street parking and the way out are looked up at once, and the
// spots on the way out tried at once: the nearest that works wins.
async function driveAndWalk(router: Router, parking: ParkingFinder | undefined, trip: TripRequest): Promise<RoutedItinerary | undefined> {
  try {
    const [found, out] = await Promise.all([parking?.near(trip.to, trip.departAt).catch(() => undefined), wayOut(router, trip).catch(() => [])]);
    const street = found?.picks.find((pick) => pick.kind === "street");
    const targets = street ? [{ lat: street.lat, lon: street.lon }] : out;
    const ways = await Promise.all(targets.map((spot) => driveThenWalk(router, trip, spot).catch(() => undefined)));
    return ways.find((way) => way !== undefined);
  } catch {
    return undefined;
  }
}

async function driveThenWalk(router: Router, trip: TripRequest, spot: { lat: number; lon: number }): Promise<RoutedItinerary | undefined> {
  const drive = (await router.plan({ ...trip, to: spot, probe: true })).find(drivesAllTheWay);
  if (!drive) return undefined;
  const [walk] = await router.plan({ from: spot, to: trip.to, mode: "walk", departAt: drive.end, ...(trip.speeds ? { speeds: trip.speeds } : {}) });
  if (!walk) return undefined;
  return { start: drive.start, end: walk.end, durationS: Math.round((Date.parse(walk.end) - Date.parse(drive.start)) / 1000), legs: [...drive.legs, ...walk.legs] };
}

// Points on foot out of B towards A, nearest first: where a car may first get.
async function wayOut(router: Router, { from, to, departAt }: TripRequest): Promise<{ lat: number; lon: number }[]> {
  const share = Math.min(1, WAY_OUT_M / Math.max(1, distanceM(to, from)));
  const towards = { lat: to.lat + (from.lat - to.lat) * share, lon: to.lon + (from.lon - to.lon) * share };
  const [walk] = await router.plan({ from: to, to: towards, mode: "walk", departAt });
  const line = (walk?.legs ?? []).flatMap((leg) => leg.geometry.coordinates);
  const points: { lat: number; lon: number }[] = [];
  let along = 0;
  for (let i = 1; i < line.length && points.length < TRIED_ALONG_M.length; i++) {
    const [lon0 = 0, lat0 = 0] = line[i - 1]!;
    const [lon = 0, lat = 0] = line[i]!;
    along += distanceM({ lat: lat0, lon: lon0 }, { lat, lon });
    if (along >= TRIED_ALONG_M[points.length]!) points.push({ lat, lon });
  }
  return points;
}
