import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import fixture from "./core/adapters/fixtures/land-use-permits.json" with { type: "json" };
import { type PermitCollection, toEvents } from "./core/adapters/land-use-permits.ts";
import { fiCapitalRegion } from "./core/regions/fi-capital-region.ts";
import { regions } from "./core/regions/index.ts";

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
});

describe("GET /v0/events", async () => {
  const source = fiCapitalRegion.sources[0]!;
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
