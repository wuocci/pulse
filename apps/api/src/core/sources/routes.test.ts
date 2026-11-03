import type { z } from "@hono/zod-openapi";
import type { CoverageSchema, SourceHealthSchema } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import type { Router } from "../adapters/digitransit-routing.ts";
import { InMemoryEventStore } from "../events/store.ts";
import { InMemorySourceHealthLog } from "../ingest/health.ts";
import { refreshSource } from "../ingest/scheduler.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { regions } from "../regions/index.ts";

const db = { ping: async () => true };
const source = (id: string) => fiCapitalRegion.sources.find((s) => s.id === id)!;
const MINUTE = 60_000;
type Coverage = z.infer<typeof CoverageSchema>;
type SourceHealth = z.infer<typeof SourceHealthSchema>;

describe("GET /v0/sources/health", () => {
  const healthAt = async (log: InMemorySourceHealthLog, now: Date) => {
    const app = createApp({ db, events: new InMemoryEventStore(), regions, sourceHealth: log, clock: () => now });
    const { sources } = (await (await app.request("/v0/sources/health")).json()) as { sources: SourceHealth[] };
    return (id: string) => sources.find((s) => s.id === id);
  };

  it("lists every Source of every Region, delayed until it has updated", async () => {
    const of = await healthAt(new InMemorySourceHealthLog(), new Date());

    expect(fiCapitalRegion.sources.map((s) => of(s.id)?.status)).toEqual(fiCapitalRegion.sources.map(() => "delayed"));
    expect(of("hsl-service-alerts")).toEqual({ id: "hsl-service-alerts", region: "fi-capital-region", publisher: "HSL", status: "delayed", refreshMinutes: 2 });
  });

  it("is ok after a refresh, and delayed once its interval has gone by without one", async () => {
    const log = new InMemorySourceHealthLog();
    await refreshSource(source("hand-kept"), fiCapitalRegion, new InMemoryEventStore(), { health: log });
    const refreshed = log.of("hand-kept")!.lastSuccessAt!;

    expect((await healthAt(log, new Date(refreshed.getTime() + 60 * MINUTE)))("hand-kept")).toMatchObject({
      status: "ok",
      lastSuccessAt: refreshed.toISOString(),
    });
    expect((await healthAt(log, new Date(refreshed.getTime() + 62 * MINUTE)))("hand-kept")?.status).toBe("delayed");
  });

  it("is down after repeated failed refreshes, with the last error, and ok again after one that works", async () => {
    const log = new InMemorySourceHealthLog();
    const roads = source("fintraffic-road-messages");
    const failing = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const refresh = (fetchFn: typeof fetch) => refreshSource(roads, fiCapitalRegion, new InMemoryEventStore(), { health: log, fetchFn });
    const ok = (async () => Response.json({ type: "FeatureCollection", features: [] })) as typeof fetch;

    await refresh(failing);
    await refresh(failing);
    expect((await healthAt(log, new Date()))(roads.id)?.status).toBe("delayed");

    await refresh(failing);
    const down = (await healthAt(log, new Date()))(roads.id);
    expect(down?.status).toBe("down");
    expect(down?.lastError?.message).toBe("connect ECONNREFUSED");

    await refresh(ok);
    expect((await healthAt(log, new Date()))(roads.id)).toMatchObject({ status: "ok", lastError: { message: "connect ECONNREFUSED" } });
  });
});

describe("GET /v0/coverage", () => {
  const router: Router = { plan: async () => [] };
  const coverageAt = async (near: string, routerFor: () => Router | undefined = () => router) => {
    const res = await createApp({ db, events: new InMemoryEventStore(), regions, routerFor }).request(`/v0/coverage?near=${near}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Coverage;
  };
  const ids = (coverage: Coverage) => coverage.sources.map((s) => s.id);

  it("lists the Helsinki excavation Source in Helsinki, and the Layers there", async () => {
    const kamppi = await coverageAt("60.1690,24.9316");

    expect(kamppi.region).toBe("fi-capital-region");
    expect(kamppi.layers).toEqual(["area", "now", "trips"]);
    expect(ids(kamppi)).toContain("hel-excavations");
    expect(ids(kamppi)).toContain("hsl-service-alerts");
  });

  it("doesn't list Helsinki's own Sources in Vantaa or Espoo, but the Region's", async () => {
    for (const near of ["60.2925,25.0440", "60.2190,24.8130"]) {
      const coverage = await coverageAt(near);

      expect(coverage.region).toBe("fi-capital-region");
      expect(ids(coverage)).not.toContain("hel-excavations");
      expect(ids(coverage)).toEqual(expect.arrayContaining(["hsl-service-alerts", "fintraffic-road-messages", "fmi-warnings"]));
    }
  });

  it("finds Helsinki on its islands and on the market square's shore", async () => {
    expect(ids(await coverageAt("60.1454,24.9881"))).toContain("hel-excavations");
    expect(ids(await coverageAt("60.1675,24.9530"))).toContain("hel-excavations");
  });

  it("says nothing is covered outside every Region", async () => {
    expect(await coverageAt("65.0121,25.4651")).toEqual({ layers: [], sources: [], unavailable: [] });
  });

  it("says emergency call-outs aren't available in the capital region", async () => {
    const { unavailable } = await coverageAt("60.1690,24.9316");

    expect(unavailable).toEqual([expect.objectContaining({ id: "emergency-call-outs", name: expect.objectContaining({ en: "Emergency call-outs" }) })]);
  });

  it("leaves out Trips where the Region has no router", async () => {
    expect((await coverageAt("60.1690,24.9316", () => undefined)).layers).toEqual(["area", "now"]);
  });

  it("asks for lat,lon", async () => {
    const res = await createApp({ db, events: new InMemoryEventStore(), regions }).request("/v0/coverage?near=helsinki");

    expect(res.status).toBe(400);
  });
});
