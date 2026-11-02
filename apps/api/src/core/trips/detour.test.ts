import type { Impact, Leg } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import type { RoutedItinerary, Router, TripRequest } from "../adapters/digitransit-routing.ts";
import { distanceM } from "../adapters/street-parking.ts";
import { detour } from "./detour.ts";

// A drive east along latitude 60.19; roadworks in its way at 24.96.
const A = { lat: 60.19, lon: 24.94 };
const B = { lat: 60.19, lon: 24.98 };
const WORKS: [number, number] = [24.96, 60.19];
const departAt = "2026-11-02T09:50:00+02:00";
const trip: TripRequest = { from: A, to: B, mode: "car", departAt };
const at = (minutes: number) => new Date(Date.parse(departAt) + minutes * 60_000).toISOString();

const drive = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, start: number, end: number): RoutedItinerary => ({
  start: at(start),
  end: at(end),
  durationS: (end - start) * 60,
  legs: [
    {
      mode: "car",
      from: { name: "", ...from },
      to: { name: "", ...to },
      start: at(start),
      end: at(end),
      stops: [],
      distanceM: Math.round(distanceM(from, to)),
      geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [to.lon, to.lat]] },
    } satisfies Leg,
  ],
});
const DIRECT = drive(A, B, 0, 12);

// Drives anywhere in `minutes(from, to)`; remembers what it was asked.
function fakeRouter(minutes: (to: { lat: number; lon: number }) => number = () => 4) {
  const asked: TripRequest[] = [];
  const router: Router = {
    async plan(request) {
      asked.push(request);
      const start = (Date.parse(request.departAt) - Date.parse(departAt)) / 60_000;
      return [drive(request.from, request.to, start, start + minutes(request.to))];
    },
  };
  return { router, asked };
}
// What's in the way: the works, on the direct drive only.
const assess = (itinerary: RoutedItinerary): { impact: Impact; inTheWay: number } =>
  itinerary === DIRECT ? { impact: "consider", inTheWay: 1 } : { impact: "none", inTheWay: 0 };

describe("a detour", () => {
  it("drives through a waypoint to either side of what's in the way, 300 and 600 m off", async () => {
    const { router, asked } = fakeRouter();

    await detour(router, trip, DIRECT, WORKS, assess);

    const waypoints = asked.filter((a) => a.from === A).map((a) => a.to);
    expect(waypoints.map((w) => Math.round(distanceM(w, { lat: WORKS[1], lon: WORKS[0] }) / 10) * 10).sort()).toEqual([300, 300, 600, 600]);
    // Sideways: north and south of an eastward drive.
    expect(waypoints.every((w) => Math.abs(w.lon - WORKS[0]) < 0.0005)).toBe(true);
    expect(asked.every((a) => a.directOnly)).toBe(true);
  });

  it("is the one with least in its way, then the earliest, as one drive", async () => {
    const { router } = fakeRouter();

    const way = await detour(router, trip, DIRECT, WORKS, assess);

    expect(way).toMatchObject({ start: at(0), end: at(8) });
    expect(way!.legs).toHaveLength(1);
    expect(way!.legs[0]).toMatchObject({ mode: "car", from: { lat: A.lat }, to: { lat: B.lat }, start: at(0), end: at(8) });
    // A, the waypoint, B.
    expect(way!.legs[0]!.geometry.coordinates).toHaveLength(3);
  });

  it("cuts the spur where it drives in to the waypoint and straight back out", async () => {
    // To the waypoint up a side street (two points in), then back down the same street and on.
    const main: [number, number] = [24.95, 60.19];
    const side: [number, number][] = [[24.95, 60.191], [24.95, 60.192]];
    const router: Router = {
      async plan(request) {
        const start = (Date.parse(request.departAt) - Date.parse(departAt)) / 60_000;
        const way = drive(request.from, request.to, start, start + 4);
        const coordinates: [number, number][] = request.from === A ? [[A.lon, A.lat], main, ...side] : [...[...side].reverse(), main, [B.lon, B.lat]];
        return [{ ...way, legs: [{ ...way.legs[0]!, geometry: { type: "LineString" as const, coordinates } }] }];
      },
    };

    const way = await detour(router, trip, DIRECT, WORKS, assess);

    expect(way!.legs[0]!.geometry.coordinates).toEqual([[A.lon, A.lat], main, [B.lon, B.lat]]);
  });

  it("isn't offered when it arrives more than 5 min after the drive", async () => {
    // 9 + 9 min: 18, against the drive's 12.
    const { router } = fakeRouter(() => 9);

    expect(await detour(router, trip, DIRECT, WORKS, assess)).toBeUndefined();
  });

  it("isn't offered when it's no better", async () => {
    const { router } = fakeRouter();

    expect(await detour(router, trip, DIRECT, WORKS, () => ({ impact: "consider", inTheWay: 1 }))).toBeUndefined();
  });

  it("skips a waypoint it can't drive to", async () => {
    const router: Router = {
      async plan(request) {
        if (request.to.lat > 60.19) throw new Error("Digitransit routing responded 503");
        return fakeRouter().router.plan(request);
      },
    };

    expect(await detour(router, trip, DIRECT, WORKS, assess)).toBeDefined();
  });
});
