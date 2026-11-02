import type { Leg, Trip } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import type { RoutedItinerary, Router, TripRequest } from "../adapters/digitransit-routing.ts";
import { distanceM } from "../adapters/street-parking.ts";
import { planCar } from "./drive.ts";
import type { ParkingFinder } from "./routes.ts";

const A = { lat: 60.1694, lon: 25.0328 };
// A sports park: no road to its point.
const B = { lat: 60.2341, lon: 25.0939 };
const STREET_SPOT = { lat: 60.2352, lon: 25.0921 };
const departAt = "2026-11-01T23:20:00+02:00";
const trip: TripRequest = { from: A, to: B, mode: "car", departAt };

const at = (minutes: number) => new Date(Date.parse(departAt) + minutes * 60_000).toISOString();
const leg = (mode: Leg["mode"], from: { lat: number; lon: number }, to: { lat: number; lon: number; parking?: string }, start: number, end: number): Leg => ({
  mode,
  from: { name: "", ...from },
  to: { name: "", ...to },
  start: at(start),
  end: at(end),
  stops: [],
  geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [to.lon, to.lat]] },
});
const way = (...legs: Leg[]): RoutedItinerary => ({
  start: legs[0]!.start,
  end: legs.at(-1)!.end,
  durationS: (Date.parse(legs.at(-1)!.end) - Date.parse(legs[0]!.start)) / 1000,
  legs,
});
const distanceFromB = (point: { lat: number; lon: number }) => distanceM(B, point);
const DRIVE = way(leg("car", A, B, 0, 15));
// Park-and-ride: the car park towards B, or back the way you came.
const TOWARDS = { lat: 60.21, lon: 25.08, parking: "Itäkeskus" };
const AWAY = { lat: 60.16, lon: 24.92, parking: "Ruoholahti" };
const parkAndRide = (park: typeof TOWARDS, end: number) => way(leg("car", A, park, 0, 8), leg("walk", park, park, 8, 10), leg("subway", park, B, 10, end));

// Out of B on foot: south, a point every 50 m or so.
const WAY_OUT = Array.from({ length: 21 }, (_, i): [number, number] => [B.lon, B.lat - (i * 50.5) / 111_320]);

// Answers the car plan to B with `ways`, a drive elsewhere with `toElsewhere(to)`; a walk out of B with WAY_OUT,
// any other walk with 3 min.
function fakeRouter(ways: RoutedItinerary[], toElsewhere: (to: { lat: number; lon: number }) => RoutedItinerary[] = () => []) {
  const asked: TripRequest[] = [];
  const router: Router = {
    async plan(request) {
      asked.push(request);
      if (request.mode === "walk") {
        const walk = leg("walk", request.from, request.to, 0, 3);
        const out = request.from === B ? { ...walk, geometry: { type: "LineString" as const, coordinates: WAY_OUT } } : walk;
        return [{ ...way(out), start: request.departAt, end: new Date(Date.parse(request.departAt) + 180_000).toISOString() }];
      }
      return request.to === B ? ways : toElsewhere(request.to);
    },
  };
  return { router, asked };
}
const picks = (...list: NonNullable<Trip["parking"]>["picks"]): ParkingFinder => ({ near: async () => ({ carParks: [], sources: [], picks: list }) });
const streetPick = { reasons: ["closest" as const], kind: "street" as const, ...STREET_SPOT, distanceM: 180, spaces: 4, cost: "free" as const, disc: false };
const carPark = { reasons: ["biggest" as const], kind: "carPark" as const, name: "Kontula P", lat: 60.23, lon: 25.08, distanceM: 760, spaces: 200, cost: "unknown" as const, disc: false };

describe("a car Trip", () => {
  it("is the drive, then park-and-ride ways worth it: towards B, arriving at most 10 min after the drive", async () => {
    const { router } = fakeRouter([DRIVE, parkAndRide(TOWARDS, 24), parkAndRide(TOWARDS, 26), parkAndRide(AWAY, 20)]);

    const ways = await planCar(router, undefined, trip);

    expect(ways.map((w) => [w.legs[0]!.to.parking, w.end])).toEqual([
      [undefined, at(15)],
      ["Itäkeskus", at(24)],
    ]);
  });

  it("drives to the best street parking and walks from there, when no car gets to B itself", async () => {
    const toSpot = way(leg("car", A, STREET_SPOT, 0, 14));
    const { router, asked } = fakeRouter([parkAndRide(TOWARDS, 38)], () => [toSpot]);

    const [drive, ...rest] = await planCar(router, picks(streetPick), trip);

    expect(asked.slice(1)).toEqual([
      { from: A, to: STREET_SPOT, mode: "car", departAt },
      { from: STREET_SPOT, to: B, mode: "walk", departAt: at(14) },
    ]);
    expect(drive!.legs.map((l) => l.mode)).toEqual(["car", "walk"]);
    expect(drive).toMatchObject({ start: at(0), end: at(17), durationS: 17 * 60 });
    // 38 min is more than 10 min after the 17 min drive.
    expect(rest).toEqual([]);
  });

  it("else drives to where a car first gets on the way out of B, not to a car park far off", async () => {
    // A car gets 250 m out, not 100 m.
    const reached = (to: { lat: number; lon: number }) => (distanceFromB(to) > 200 ? [way(leg("car", A, to, 0, 13))] : []);
    const { router, asked } = fakeRouter([], reached);

    const [drive] = await planCar(router, picks(carPark), trip);

    const tried = asked.filter((a) => a.mode === "car" && a.to !== B).map((a) => Math.round(distanceFromB(a.to) / 50) * 50);
    expect(tried).toEqual([100, 250]);
    expect(drive!.legs.map((l) => l.mode)).toEqual(["car", "walk"]);
    expect(drive!.end).toBe(at(16));
  });

  it("offers no park-and-ride ways alone: without a drive to weigh them against, they can't be told worth it", async () => {
    const { router } = fakeRouter([parkAndRide(TOWARDS, 38)]);

    expect(await planCar(router, picks(), trip)).toEqual([]);
    expect(await planCar(router, undefined, trip)).toEqual([]);
  });

  it("gives up on the walk-in drive quietly when it can't be planned", async () => {
    const router: Router = {
      async plan(request) {
        if (request.to === B) return [parkAndRide(TOWARDS, 38)];
        throw new Error("Digitransit routing responded 503");
      },
    };

    expect(await planCar(router, picks(streetPick), trip)).toEqual([]);
  });
});
