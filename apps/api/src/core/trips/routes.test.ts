import type { Event, Leg, Trip } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import type { RoutedItinerary, Router, TripRequest } from "../adapters/digitransit-routing.ts";
import { InMemoryEventStore } from "../events/store.ts";
import { type Region, regions } from "../regions/index.ts";

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
const route = (mode: string): RoutedItinerary => ({ start: walk.start, end: walk.end, durationS: mode === "bike" ? 300 : 600, legs: [walk] });

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

async function appWith(routerFor?: (region: Region) => Router | undefined) {
  const events = new InMemoryEventStore();
  await events.replaceSource("src", [works, elsewhere]);
  return createApp({ db: { ping: async () => true }, events, regions, clock: () => NOW, ...(routerFor ? { routerFor } : {}) });
}

const get = async (app: Awaited<ReturnType<typeof appWith>>, query: string) => app.request(`/v0/trips?${query}`);
const AB = "from=60.17,24.93&to=60.17,24.94";

describe("GET /v0/trips", () => {
  it("plans every mode from A to B now, with the Events on each itinerary and its Impact", async () => {
    const { router, asked } = fakeRouter();
    const res = await get(await appWith(() => router), AB);

    expect(res.status).toBe(200);
    expect(asked).toEqual(
      ["transit", "walk", "bike"].map((mode) => ({ from: { lat: 60.17, lon: 24.93 }, to: { lat: 60.17, lon: 24.94 }, mode, departAt: NOW.toISOString() })),
    );
    const body = (await res.json()) as Trip;
    expect(body.events.map((e) => e.id)).toEqual(["src:works"]);
    expect(body.plans).toEqual([
      { mode: "transit", itineraries: [{ ...route("transit"), eventIds: ["src:works"], impact: "consider" }] },
      { mode: "walk", itineraries: [] },
      { mode: "bike", itineraries: [{ ...route("bike"), eventIds: ["src:works"], impact: "consider" }] },
    ]);
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
    expect((await get(app, `${AB}&modes=car`)).status).toBe(400);
  });
});
