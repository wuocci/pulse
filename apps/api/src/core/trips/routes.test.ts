import type { Event, Leg, Trip } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import type { RoutedItinerary, Router, TripRequest } from "../adapters/digitransit-routing.ts";
import { InMemoryEventStore } from "../events/store.ts";
import { type Region, regions } from "../regions/index.ts";
import type { ParkingFinder } from "./routes.ts";

const NOW = new Date("2026-10-31T10:00:00Z");
const LAT = 60.17;

const walk: Leg = {
  mode: "walk",
  from: { name: "A", lat: LAT, lon: 24.93 },
  to: { name: "B", lat: LAT, lon: 24.94 },
  start: "2026-10-31T12:00:00+02:00",
  end: "2026-10-31T12:10:00+02:00",
  stops: [],
  geometry: { type: "LineString", coordinates: [[24.93, LAT], [24.94, LAT]] },
};
const route = (mode: string): RoutedItinerary => ({
  start: walk.start,
  end: walk.end,
  durationS: mode === "bike" ? 300 : 600,
  legs: [mode === "car" ? { ...walk, mode: "car" } : walk],
});

const works: Event = {
  id: "src:works",
  kind: "works",
  layers: ["area"],
  title: { en: "Works on the way" },
  where: { geometry: { type: "Point", coordinates: [24.935, LAT + 0.0001] }, precision: "area" },
  when: { start: "2026-10-01T00:00:00+03:00" },
  severity: "minor",
  mainlyAffected: "unknown",
  noticeable: ["noise", "blocked"],
  status: "active",
  sources: [{ name: "City", id: "works", updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0,
  updatedAt: "2026-10-01T00:00:00+03:00",
};
const elsewhere: Event = { ...works, id: "src:elsewhere", where: { ...works.where, geometry: { type: "Point", coordinates: [25.1, 60.3] } } };

function fakeRouter({ fail = false } = {}) {
  const asked: TripRequest[] = [];
  const router: Router = {
    async plan(trip) {
      asked.push(trip);
      if (fail) throw new Error("Digitransit routing responded 503");
      return trip.mode === "walk" ? [] : [route(trip.mode)];
    },
  };
  return { router, asked };
}

async function appWith(routerFor?: (region: Region) => Router | undefined, parkingFor?: (region: Region) => ParkingFinder | undefined) {
  const events = new InMemoryEventStore();
  await events.replaceSource("src", [works, elsewhere]);
  return createApp({
    db: { ping: async () => true },
    events,
    regions,
    clock: () => NOW,
    ...(routerFor ? { routerFor } : {}),
    ...(parkingFor ? { parkingFor } : {}),
  });
}

const get = async (app: Awaited<ReturnType<typeof appWith>>, query: string) => app.request(`/v0/trips?${query}`);
const AB = "from=60.17,24.93&to=60.17,24.94";

describe("GET /v0/trips", () => {
  it("plans every mode from A to B now, with the Events on each itinerary and its Impact", async () => {
    const { router, asked } = fakeRouter();
    const res = await get(await appWith(() => router), AB);

    expect(res.status).toBe(200);
    expect(asked).toEqual(
      ["transit", "walk", "bike", "car"].map((mode) => ({ from: { lat: 60.17, lon: 24.93 }, to: { lat: 60.17, lon: 24.94 }, mode, departAt: NOW.toISOString() })),
    );
    const body = (await res.json()) as Trip;
    expect(body.events.map((e) => e.id)).toEqual(["src:works"]);
    const onTheWay = [{ eventId: "src:works", impact: "consider", leg: 0, minutes: 5, at: [expect.closeTo(24.935, 4), expect.closeTo(LAT, 4)] }];
    expect(body.plans).toEqual([
      { mode: "transit", itineraries: [{ ...route("transit"), eventIds: ["src:works"], onTheWay, comingUp: [], impact: "consider" }] },
      { mode: "walk", itineraries: [] },
      { mode: "bike", itineraries: [{ ...route("bike"), eventIds: ["src:works"], onTheWay, comingUp: [], impact: "consider" }] },
      // Works that block without saying whom aren't in a car's way.
      { mode: "car", itineraries: [{ ...route("car"), eventIds: ["src:works"], onTheWay: [{ ...onTheWay[0], impact: "minor" }], comingUp: [], impact: "minor" }] },
    ]);
  });

  it("tells where the trip meets each Event, in the order it does, with how much each matters", async () => {
    const early: Event = { ...works, id: "src:early", mainlyAffected: "drivers", noticeable: [], where: { ...works.where, geometry: { type: "Point", coordinates: [24.931, LAT] } } };
    const events = new InMemoryEventStore();
    await events.replaceSource("src", [works, early]);
    const app = createApp({ db: { ping: async () => true }, events, regions, clock: () => NOW, routerFor: () => fakeRouter().router });

    const body = (await (await get(app, `${AB}&modes=bike`)).json()) as Trip;

    expect(body.plans[0]!.itineraries[0]!.onTheWay.map((m) => [m.eventId, m.minutes, m.impact])).toEqual([
      ["src:early", 1, "minor"],
      ["src:works", 5, "consider"],
    ]);
  });

  it("marks the way that's better today, and none when the fastest is fine", async () => {
    const clear: Leg = { ...walk, geometry: { type: "LineString", coordinates: [[24.93, 60.2], [24.94, 60.2]] } };
    const router: Router = {
      plan: async ({ mode }) => (mode === "bike" ? [{ ...route("bike"), legs: [clear] }] : mode === "transit" ? [route("transit")] : []),
    };

    const body = (await (await get(await appWith(() => router), AB)).json()) as Trip;

    expect(body.recommended).toEqual({ mode: "bike", index: 0 });
    const fine = (await (await get(await appWith(() => router), `${AB}&modes=bike`)).json()) as Trip;
    expect(fine.recommended).toBeUndefined();
  });

  it("gives a heads-up of what starts on the way in the coming week, not what's further off or only nearby", async () => {
    const closing = (id: string, start: string, patch: Partial<Event> = {}): Event => ({ ...works, id, when: { start }, status: "upcoming", ...patch });
    const events = new InMemoryEventStore();
    await events.replaceSource("src", [
      closing("src:next-week", "2026-11-05T06:00:00+02:00"),
      closing("src:in-a-month", "2026-12-01T06:00:00+02:00"),
      closing("src:drivers-only", "2026-11-04T06:00:00+02:00", { mainlyAffected: "drivers", noticeable: [] }),
    ]);
    const app = createApp({ db: { ping: async () => true }, events, regions, clock: () => NOW, routerFor: () => fakeRouter().router });

    const body = (await (await get(app, `${AB}&modes=bike`)).json()) as Trip;

    const [bike] = body.plans[0]!.itineraries;
    expect(bike!.comingUp.map((m) => [m.eventId, m.startsAt, m.impact])).toEqual([["src:next-week", "2026-11-05T06:00:00+02:00", "consider"]]);
    expect(bike!.eventIds).toEqual([]);
    expect(body.events.map((e) => e.id)).toEqual(["src:next-week"]);
  });

  it("offers a detour round roadworks in the drive's way, as better today", async () => {
    const roadworks: Event = { ...works, id: "src:roadworks", mainlyAffected: "drivers", severity: "consider", noticeable: ["blocked"] };
    const events = new InMemoryEventStore();
    await events.replaceSource("src", [roadworks]);
    // A straight drive, 10 min; anywhere else 4 min a part.
    const straight = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, minutes: number, departAt: string): RoutedItinerary => {
      const end = new Date(Date.parse(departAt) + minutes * 60_000).toISOString();
      const car: Leg = { ...walk, mode: "car", from: { name: "", ...from }, to: { name: "", ...to }, start: departAt, end, geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [to.lon, to.lat]] } };
      return { start: departAt, end, durationS: minutes * 60, legs: [car] };
    };
    const asked: TripRequest[] = [];
    const router: Router = {
      async plan(trip) {
        asked.push(trip);
        return [straight(trip.from, trip.to, trip.directOnly ? 4 : 10, trip.departAt)];
      },
    };
    const app = createApp({ db: { ping: async () => true }, events, regions, clock: () => NOW, routerFor: () => router });

    const body = (await (await get(app, `${AB}&modes=car&departAt=2026-10-31T12:00:00%2B02:00`)).json()) as Trip;

    const [drive, around] = body.plans[0]!.itineraries;
    expect(drive!.onTheWay.map((m) => [m.eventId, m.impact])).toEqual([["src:roadworks", "consider"]]);
    expect(around).toMatchObject({ impact: "none", eventIds: [], legs: [{ mode: "car" }] });
    expect(body.recommended).toEqual({ mode: "car", index: 1 });
  });

  it("doesn't try to drive round what's on the whole way", async () => {
    const slippery: Event = {
      ...works,
      id: "fmi:slippery",
      kind: "weather",
      severity: "major",
      mainlyAffected: "drivers",
      noticeable: [],
      where: { geometry: { type: "Polygon", coordinates: [[[24.5, 60], [25.2, 60], [25.2, 60.4], [24.5, 60.4], [24.5, 60]]] }, precision: "area" },
    };
    const events = new InMemoryEventStore();
    await events.replaceSource("fmi", [slippery]);
    const asked: TripRequest[] = [];
    const router: Router = {
      async plan(trip) {
        asked.push(trip);
        return [route("car")];
      },
    };
    const app = createApp({ db: { ping: async () => true }, events, regions, clock: () => NOW, routerFor: () => router });

    const body = (await (await get(app, `${AB}&modes=car`)).json()) as Trip;

    expect(body.plans[0]!.itineraries).toHaveLength(1);
    expect(body.plans[0]!.itineraries[0]).toMatchObject({ impact: "major", onTheWay: [{ eventId: "fmi:slippery", impact: "major", wholeWay: true }] });
    // Only the trip itself was planned: no drive to a waypoint off to the side.
    expect(asked.every((t) => t.from.lon === 24.93 && t.to.lon === 24.94)).toBe(true);
  });

  it("steers round the next thing in the way when there's no way round the first", async () => {
    const at = (lon: number): Event => ({ ...works, id: `src:roadworks-${lon}`, mainlyAffected: "drivers", severity: "consider", noticeable: ["blocked"], where: { ...works.where, geometry: { type: "Point", coordinates: [lon, LAT + 0.0001] } } });
    const events = new InMemoryEventStore();
    await events.replaceSource("src", [at(24.932), at(24.938)]);
    const straight = (from: { lat: number; lon: number }, to: { lat: number; lon: number }, minutes: number, departAt: string): RoutedItinerary => {
      const end = new Date(Date.parse(departAt) + minutes * 60_000).toISOString();
      const car: Leg = { ...walk, mode: "car", from: { name: "", ...from }, to: { name: "", ...to }, start: departAt, end, geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [to.lon, to.lat]] } };
      return { start: departAt, end, durationS: minutes * 60, legs: [car] };
    };
    // No car gets to a waypoint round the first roadworks.
    const router: Router = {
      async plan(trip) {
        if (trip.directOnly && trip.to !== undefined && Math.abs(trip.to.lon - 24.932) < 0.001 && trip.to.lat !== LAT) return [];
        return [straight(trip.from, trip.to, trip.directOnly ? 4 : 10, trip.departAt)];
      },
    };
    const app = createApp({ db: { ping: async () => true }, events, regions, clock: () => NOW, routerFor: () => router });

    const body = (await (await get(app, `${AB}&modes=car&departAt=2026-10-31T12:00:00%2B02:00`)).json()) as Trip;

    expect(body.plans[0]!.itineraries).toHaveLength(2);
    expect(body.recommended).toEqual({ mode: "car", index: 1 });
  });

  describe("parking near the destination", () => {
    const PARKING: NonNullable<Trip["parking"]> = {
      street: { spaces: 19, paid: 15, free: 4, ev: 0, accessible: 0, radiusM: 300, places: [{ lat: 60.2, lon: 24.94, spaces: 19, kind: "paid", disc: false }] },
      carParks: [{ name: "Postintaival", lat: 60.2, lon: 24.94, carSpaces: 47, distanceM: 600 }],
      sources: ["City of Helsinki (CC BY 4.0)"],
      picks: [{ reasons: ["closest"], kind: "street", lat: 60.2, lon: 24.94, distanceM: 80, spaces: 19, cost: "paid", disc: false }],
    };
    const finder = (fail = false) => {
      const asked: [{ lat: number; lon: number }, string][] = [];
      const parking: ParkingFinder = {
        async near(point, arriveAt) {
          asked.push([point, arriveAt]);
          if (fail) throw new Error("WFS down");
          return PARKING;
        },
      };
      return { parking, asked };
    };

    it("comes with a car Trip, found around B for when the drive arrives", async () => {
      const { parking, asked } = finder();

      const body = (await (await get(await appWith(() => fakeRouter().router, () => parking), AB)).json()) as Trip;

      expect(body.parking).toEqual(PARKING);
      expect(asked).toEqual([[{ lat: 60.17, lon: 24.94 }, walk.end]]);
    });

    it("isn't looked for without a car route", async () => {
      const { parking, asked } = finder();

      const body = (await (await get(await appWith(() => fakeRouter().router, () => parking), `${AB}&modes=bike`)).json()) as Trip;

      expect(body.parking).toBeUndefined();
      expect(asked).toEqual([]);
    });

    it("doesn't hold up the Trip when it can't be found", async () => {
      const res = await get(await appWith(() => fakeRouter().router, () => finder(true).parking), AB);

      expect(res.status).toBe(200);
      expect(((await res.json()) as Trip).parking).toBeUndefined();
    });
  });

  it("plans only the modes asked for, departing when asked", async () => {
    const { router, asked } = fakeRouter();

    await get(await appWith(() => router), `${AB}&modes=bike&departAt=2026-11-02T08:00:00%2B02:00`);

    expect(asked.map((a) => [a.mode, a.departAt])).toEqual([["bike", "2026-11-02T08:00:00+02:00"]]);
  });

  it("needs A and B in the same Region", async () => {
    const { router, asked } = fakeRouter();
    const app = await appWith(() => router);

    expect((await get(app, "from=60.17,24.93&to=48.85,2.35")).status).toBe(400);
    expect((await get(app, "from=48.85,2.35&to=48.86,2.36")).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("says Trips are off when the Region has no router, and says so when planning fails", async () => {
    expect((await get(await appWith(), AB)).status).toBe(503);
    expect((await get(await appWith(() => fakeRouter({ fail: true }).router), AB)).status).toBe(502);
  });

  it("checks the query", async () => {
    const app = await appWith(() => fakeRouter().router);

    expect((await get(app, "from=60.17,24.93")).status).toBe(400);
    expect((await get(app, `${AB}&modes=boat`)).status).toBe(400);
  });
});

describe("GET /v0/trips around a big event (#49)", () => {
  // A concert at B that ended ten minutes before departure: resolved, its crowd still leaving as the trip arrives.
  const concert: Event = {
    ...works,
    id: "cal:concert",
    kind: "public_event",
    title: { en: "Concert at the arena" },
    where: { geometry: { type: "Point", coordinates: [24.94, LAT + 0.002] }, precision: "exact" },
    when: { start: "2026-10-31T09:00:00+02:00", end: "2026-10-31T11:50:00+02:00" },
    severity: "consider",
    mainlyAffected: "everyone",
    noticeable: ["crowd"],
    crowdSize: 13000,
    status: "resolved",
    updatedAt: "2026-10-31T11:55:00+02:00",
  };

  it("puts the crowd leaving a concert that's just over on the way, worth considering, with when it ended", async () => {
    const events = new InMemoryEventStore();
    await events.replaceSource("cal", [concert]);
    const { router } = fakeRouter();
    const app = createApp({ db: { ping: async () => true }, events, regions, clock: () => NOW, routerFor: () => router });

    const body = (await (await get(app, AB)).json()) as Trip;
    const bike = body.plans.find((p) => p.mode === "bike")?.itineraries[0];

    expect(bike?.impact).toBe("consider");
    expect(bike?.onTheWay).toEqual([
      { eventId: "cal:concert", impact: "consider", leg: 0, minutes: 10, at: [24.94, LAT], crowd: { at: "end", time: "2026-10-31T11:50:00+02:00" } },
    ]);
  });
});
