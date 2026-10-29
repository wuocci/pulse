import { createClient } from "@pulse/client";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import fixture from "./core/adapters/fixtures/land-use-permits/excavations.json" with { type: "json" };
import { type PermitCollection, toEvents } from "./core/adapters/land-use-permits.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import { fiCapitalRegion } from "./core/regions/fi-capital-region.ts";
import { isPermitSource, regions } from "./core/regions/index.ts";
import { buildSpec } from "./openapi.ts";

// A client whose requests go straight into the app; remembers the URLs it was asked for.
function clientFor(app: ReturnType<typeof createApp>) {
  const urls: string[] = [];
  const client = createClient({
    baseUrl: "https://pulse.test/",
    fetch: async (request) => {
      urls.push(request.url);
      return app.request(request);
    },
  });
  return { client, urls };
}

describe("buildSpec", () => {
  it("is the document the API serves", async () => {
    const app = createApp({ db: { ping: async () => true }, events: new InMemoryEventStore(), regions });
    const served = await (await app.request("/v0/openapi.json")).json();

    expect(await buildSpec()).toEqual(served);
  });
});

describe("@pulse/client against the real app", () => {
  it("gets typed Events from /v0/events", async () => {
    const source = fiCapitalRegion.sources.filter(isPermitSource)[0]!;
    const now = new Date("2026-10-24T12:00:00+03:00");
    const store = new InMemoryEventStore();
    await store.replaceSource(source.id, toEvents(fixture as PermitCollection, { source, timeZone: fiCapitalRegion.timeZone, now }));
    const app = createApp({ db: { ping: async () => true }, events: store, regions });
    const { client, urls } = clientFor(app);

    const { data, error } = await client.GET("/events", {
      params: { query: { near: "60.1699,24.9384,20000", status: "active,upcoming,resolved" } },
    });

    expect(error).toBeUndefined();
    expect(new URL(urls[0]!).pathname).toBe("/v0/events");
    expect(data?.events.length).toBeGreaterThan(0);
    // Typed: no casts needed to reach into an Event.
    expect(data?.events.every((e) => e.sources[0]?.name && e.kind === "works")).toBe(true);
  });

  it("returns the API's error for a bad query", async () => {
    const app = createApp({ db: { ping: async () => true }, events: new InMemoryEventStore(), regions });
    const { client } = clientFor(app);

    const { data, response } = await client.GET("/events", { params: { query: { near: "Töölö" } } });

    expect(data).toBeUndefined();
    expect(response.status).toBe(400);
  });
});
