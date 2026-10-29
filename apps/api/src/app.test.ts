import type { DailyHours, Event, EventKind, Layer, Noticeable } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import fixture from "./core/adapters/fixtures/land-use-permits/excavations.json" with { type: "json" };
import { type PermitCollection, toEvents } from "./core/adapters/land-use-permits.ts";
import { fiCapitalRegion } from "./core/regions/fi-capital-region.ts";
import { isPermitSource, regions } from "./core/regions/index.ts";

const reachable = { ping: async () => true };
const unreachable = {
  ping: async () => {
    throw new Error("connection refused");
  },
};
const emptyStore = new InMemoryEventStore();

describe("GET /v0/health", () => {
  it("reports ok when the database is reachable", async () => {
    const res = await createApp({ db: reachable, events: emptyStore, regions }).request("/v0/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("reports degraded when the database is unreachable", async () => {
    const res = await createApp({ db: unreachable, events: emptyStore, regions }).request("/v0/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", database: "unreachable" });
  });
});

describe("GET /v0/openapi.json", () => {
  it("serves an OpenAPI 3.1 document with the Event schema", async () => {
    const res = await createApp({ db: reachable, events: emptyStore, regions }).request("/v0/openapi.json");
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { required?: string[] }> };
    };

    expect(res.status).toBe(200);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths).toHaveProperty("/health");
    expect(doc.paths).toHaveProperty("/events");
    expect(doc.paths).toHaveProperty("/regions");
    expect(doc.components.schemas).toHaveProperty("Event");
    expect(doc.components.schemas.Event?.required).toEqual(
      expect.arrayContaining(["id", "kind", "where", "when", "severity", "sources"]),
    );
  });

  it("documents Noticeable, daily hours and the Right now query", async () => {
    const res = await createApp({ db: reachable, events: emptyStore, regions }).request("/v0/openapi.json");
    const doc = (await res.json()) as {
      paths: { "/events": { get: { parameters: { name: string }[] } } };
      components: { schemas: Record<string, { required?: string[] }> };
    };

    expect(doc.components.schemas).toHaveProperty("Noticeable");
    expect(doc.components.schemas).toHaveProperty("DailyHours");
    expect(doc.components.schemas.Event?.required).toContain("noticeable");
    expect(doc.paths["/events"].get.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(["layer", "noticeable"]));
  });

  it("documents the Classifier's fields: kind of work, Mainly affected and the end date conflict", async () => {
    const res = await createApp({ db: reachable, events: emptyStore, regions }).request("/v0/openapi.json");
    const doc = (await res.json()) as {
      components: { schemas: Record<string, { required?: string[]; properties?: Record<string, unknown> }> };
    };
    const event = doc.components.schemas.Event!;

    expect(doc.components.schemas).toHaveProperty("WorkType");
    expect(doc.components.schemas).toHaveProperty("MainlyAffected");
    expect(doc.components.schemas).toHaveProperty("EndConflict");
    expect(event.properties).toHaveProperty("workType");
    expect(event.required).toContain("mainlyAffected");
    expect(event.required).not.toContain("workType");
    expect(JSON.stringify(event.properties?.when)).toContain("endConflict");
  });
});

describe("GET /v0/events", async () => {
  const source = fiCapitalRegion.sources.filter(isPermitSource)[0]!;
  const store = new InMemoryEventStore();
  await store.replaceSource(
    source.id,
    toEvents(fixture as PermitCollection, {
      source,
      timeZone: fiCapitalRegion.timeZone,
      // KP2603005 ended on 30 Oct; the others are active or upcoming.
      now: new Date("2026-11-01T12:00:00+02:00"),
    }),
  );
  const app = createApp({ db: reachable, events: store, regions });
  const ids = async (query: string) => {
    const res = await app.request(`/v0/events${query}`);
    const body = (await res.json()) as { events: { id: string }[] };
    return body.events.map((e) => e.id).sort();
  };

  it("returns active and upcoming Events without filters", async () => {
    expect(await ids("")).toHaveLength(3);
  });

  it("returns ended Events only when asked", async () => {
    expect(await ids("?status=resolved")).toEqual([`${source.id}:KP2603005`]);
    expect(await ids("?status=active,upcoming,resolved")).toHaveLength(4);
  });

  it("rejects an unknown status", async () => {
    const res = await app.request("/v0/events?status=cancelled");
    expect(res.status).toBe(400);
  });

  it("searches within 1 km by default", async () => {
    // About 700 m from the Sibeliuksenkatu notice.
    expect(await ids("?near=60.1830,24.9365")).toContain(`${source.id}:KP2602966`);
  });

  it("returns only Events within the radius", async () => {
    // Sibeliuksenkatu 3, Töölö; the nearest other notice is about 2 km away.
    expect(await ids("?near=60.1830,24.9237,200")).toEqual([`${source.id}:KP2602966`]);
  });

  it("returns only Events overlapping the time window", async () => {
    expect(await ids("?from=2026-11-06T00:00:00%2B02:00")).toEqual([`${source.id}:KP2602791-2`]);
  });

  it("filters by kind", async () => {
    expect(await ids("?kind=weather")).toEqual([]);
  });

  it("rejects a malformed near parameter", async () => {
    const res = await app.request("/v0/events?near=Töölö");
    expect(res.status).toBe(400);
  });
});

describe("GET /v0/events?layer=now", () => {
  // A made-up spot in Helsinki; seeded Events sit due north of it.
  const here = { lat: 60.17, lon: 24.95 };
  const metresPerDegreeLat = 111_195;
  // 2026-11-03 is a Tuesday and 2026-11-08 a Sunday, both in winter time (+02:00).
  const tuesday = (time: string) => `2026-11-03T${time}:00+02:00`;

  const seed = (
    id: string,
    kind: EventKind,
    metresNorth: number,
    {
      noticeable = [],
      dailyHours,
      layers = ["area"],
    }: { noticeable?: Noticeable[]; dailyHours?: DailyHours; layers?: Layer[] } = {},
  ): Event => ({
    id,
    kind,
    layers,
    title: { en: id },
    where: {
      geometry: { type: "Point", coordinates: [here.lon, here.lat + metresNorth / metresPerDegreeLat] },
      precision: "area",
    },
    when: { start: "2026-10-01T00:00:00+03:00", end: "2026-12-31T23:59:59+02:00", ...(dailyHours ? { dailyHours } : {}) },
    severity: "minor",
    mainlyAffected: "unknown",
    noticeable,
    status: "active",
    sources: [{ name: "Test Source", id, updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
    confidence: 0,
    updatedAt: "2026-10-01T00:00:00+03:00",
  });

  const request = async (events: Event[], now: string, query = "") => {
    const store = new InMemoryEventStore();
    await store.replaceSource("test", events);
    const app = createApp({ db: reachable, events: store, regions, clock: () => new Date(now) });
    return app.request(`/v0/events?near=${here.lat},${here.lon}&layer=now${query}`);
  };
  const ids = async (events: Event[], now: string, query = "") => {
    const res = await request(events, now, query);
    const body = (await res.json()) as { events: { id: string }[] };
    return body.events.map((e) => e.id);
  };

  const dig = seed("dig", "works", 100, { noticeable: ["noise", "blocked"] });

  it("returns a dig during working hours on a weekday only", async () => {
    expect(await ids([dig], tuesday("10:00"))).toEqual(["dig"]);
    expect(await ids([dig], tuesday("02:00"))).toEqual([]);
    expect(await ids([dig], "2026-11-08T10:00:00+02:00")).toEqual([]);
  });

  it("reads daily hours in the Region's local time, including summer time", async () => {
    // 04:30 UTC is 07:30 in Helsinki on Friday 23 Oct (+03:00), but 06:30 on Tuesday 3 Nov (+02:00).
    expect(await ids([dig], "2026-10-23T04:30:00Z")).toEqual(["dig"]);
    expect(await ids([dig], "2026-11-03T04:30:00Z")).toEqual([]);
  });

  it("leaves out Events whose time window doesn't contain now", async () => {
    expect(await ids([dig], "2027-01-05T10:00:00+02:00")).toEqual([]);
  });

  it("lets a Source's own daily hours win over the kind's default", async () => {
    const laneClosure = seed("own-hours", "works", 100, { dailyHours: { from: "09:00", to: "15:00" } });

    expect(await ids([laneClosure], tuesday("08:00"))).toEqual([]);
    expect(await ids([laneClosure], tuesday("16:00"))).toEqual([]);
    expect(await ids([laneClosure], "2026-11-08T10:00:00+02:00")).toEqual(["own-hours"]);
  });

  it("follows daily hours past midnight", async () => {
    const nightWorks = seed("night", "works", 100, { dailyHours: { from: "22:00", to: "05:00", days: ["mon"] } });

    expect(await ids([nightWorks], tuesday("02:00"))).toEqual(["night"]);
    expect(await ids([nightWorks], tuesday("23:00"))).toEqual([]);
  });

  it("counts a kind without default hours all day", async () => {
    expect(await ids([seed("closure", "closure", 100, { noticeable: ["blocked"] })], tuesday("02:00"))).toEqual(["closure"]);
  });

  it("ranks noticeable Events first, then by distance", async () => {
    const concert = seed("concert", "public_event", 400, { noticeable: ["crowd", "noise"] });
    const quietDig = seed("quiet-dig", "works", 50);
    const loudDig = seed("loud-dig", "works", 50, { noticeable: ["noise"] });

    expect(await ids([quietDig, concert], tuesday("12:00"))).toEqual(["concert", "quiet-dig"]);
    expect(await ids([concert, loudDig], tuesday("12:00"))).toEqual(["loud-dig", "concert"]);
  });

  it("searches within 500 m by default", async () => {
    const near = seed("near", "closure", 450);
    const far = seed("far", "closure", 700);

    expect(await ids([near, far], tuesday("12:00"))).toEqual(["near"]);
  });

  it("takes an explicit radius up to 2 km and rejects a larger one", async () => {
    const app = createApp({ db: reachable, events: emptyStore, regions });
    const status = async (query: string) => (await app.request(`/v0/events?near=${here.lat},${here.lon},${query}`)).status;

    expect(await status("2000&layer=now")).toBe(200);
    expect(await status("2001&layer=now")).toBe(400);
    // Without the lens there is no cap.
    expect(await status("5000")).toBe(200);
  });

  it("requires a location", async () => {
    const app = createApp({ db: reachable, events: emptyStore, regions });

    expect((await app.request("/v0/events?layer=now")).status).toBe(400);
  });

  it("filters by what is noticeable, any match", async () => {
    const events = [
      dig,
      seed("concert", "public_event", 400, { noticeable: ["crowd", "noise"] }),
      seed("closure", "closure", 200, { noticeable: ["blocked"] }),
    ];

    expect(await ids(events, tuesday("12:00"), "&noticeable=noise")).toEqual(["dig", "concert"]);
    expect(await ids(events, tuesday("12:00"), "&noticeable=crowd,blocked")).toEqual(["dig", "closure", "concert"]);
    expect((await request(events, tuesday("12:00"), "&noticeable=smell")).status).toBe(400);
  });

  it("takes only Events on the area or Right now Layer, leaving out ones for trips alone", async () => {
    const events = [
      seed("stop-closed", "disruption", 100, { noticeable: ["outage"], layers: ["trips", "now"] }),
      seed("timetable-change", "disruption", 50, { layers: ["trips"] }),
      seed("closure", "closure", 200),
    ];

    expect(await ids(events, tuesday("12:00"))).toEqual(["stop-closed", "closure"]);
  });
});

describe("GET /v0/regions", () => {
  it("lists each Region without its Source configs", async () => {
    const res = await createApp({ db: reachable, events: emptyStore, regions }).request("/v0/regions");
    const body = (await res.json()) as { regions: Record<string, unknown>[] };

    expect(res.status).toBe(200);
    expect(body.regions).toEqual([
      {
        id: "fi-capital-region",
        name: fiCapitalRegion.name,
        bbox: fiCapitalRegion.bbox,
        timeZone: "Europe/Helsinki",
        languages: ["fi", "sv", "en"],
      },
    ]);
  });
});
