import type { RoutedItinerary, Router, TripRequest } from "../adapters/digitransit-routing.ts";
import { distanceM } from "../adapters/street-parking.ts";
import type { ParkingFinder } from "./routes.ts";

// A car Trip: the drive, then the park-and-ride ways worth offering beside it — those that park towards B and
// arrive at most 10 min after the drive. When no car gets to B itself (a park, a pedestrian street: its point is
// off the roads), the drive goes as near as it can and walks the rest, as a driver would: to the best street
// parking near B when there's any, else to where a car first gets on the way out of B. Without any drive there's
// nothing to weigh park-and-ride against: none is offered.

const PARK_AND_RIDE_LATER_MS = 10 * 60_000;
// The way out of B: a walk this far towards A, tried for a car this far along it.
const WAY_OUT_M = 1000;
const TRIED_ALONG_M = [100, 250, 500];

const drivesAllTheWay = ({ legs }: RoutedItinerary) => legs.length > 0 && legs.every((leg) => leg.mode === "car");

export async function planCar(router: Router, parking: ParkingFinder | undefined, trip: TripRequest): Promise<RoutedItinerary[]> {
  const ways = await router.plan(trip);
  const drive = ways.find(drivesAllTheWay) ?? (await driveAndWalk(router, parking, trip));
  if (!drive) return [];
  return [drive, ...ways.filter((way) => !drivesAllTheWay(way) && worthIt(way, trip, drive))];
}

function worthIt({ legs, end }: RoutedItinerary, { from, to }: TripRequest, drive: RoutedItinerary): boolean {
  const parking = legs[0]?.mode === "car" ? legs[0].to : undefined;
  if (!parking?.parking || distanceM(parking, to) >= distanceM(from, to)) return false;
  return Date.parse(end) <= Date.parse(drive.end) + PARK_AND_RIDE_LATER_MS;
}

// Drive as near B as a car gets, then walk to B.
async function driveAndWalk(router: Router, parking: ParkingFinder | undefined, trip: TripRequest): Promise<RoutedItinerary | undefined> {
  try {
    const street = (await parking?.near(trip.to, trip.departAt).catch(() => undefined))?.picks.find((pick) => pick.kind === "street");
    const targets = street ? [{ lat: street.lat, lon: street.lon }] : await wayOut(router, trip);
    for (const spot of targets) {
      const drive = (await router.plan({ ...trip, to: spot })).find(drivesAllTheWay);
      if (!drive) continue;
      const [walk] = await router.plan({ from: spot, to: trip.to, mode: "walk", departAt: drive.end });
      if (!walk) return undefined;
      return { start: drive.start, end: walk.end, durationS: Math.round((Date.parse(walk.end) - Date.parse(drive.start)) / 1000), legs: [...drive.legs, ...walk.legs] };
    }
    return undefined;
  } catch {
    return undefined;
  }
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
