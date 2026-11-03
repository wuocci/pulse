import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { CoverageSchema, type Layer, SourceHealthSchema } from "@pulse/schema";
import type { Router } from "../adapters/digitransit-routing.ts";
import { type SourceHealthLog, statusOf } from "../ingest/health.ts";
import { type Region, regionAt, sourcesAt } from "../regions/index.ts";

// How far to trust what the API answers: whether each Source keeps up, and what's known about a place at all.
// Both keep a client from showing a false all clear (PLAN.md, Risks).

const healthRoute = createRoute({
  method: "get",
  path: "/sources/health",
  responses: {
    200: {
      description: "Each Source of each Region: when it last updated, its last error, and whether it keeps up",
      content: { "application/json": { schema: z.object({ sources: z.array(SourceHealthSchema) }) } },
    },
  },
});

const coverageRoute = createRoute({
  method: "get",
  path: "/coverage",
  request: {
    query: z.object({
      near: z
        .string()
        .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "Expected lat,lon")
        .openapi({ example: "60.1699,24.9384" }),
    }),
  },
  responses: {
    200: {
      description: "The Layers and Sources at the point, from Region config; none outside every Region",
      content: { "application/json": { schema: CoverageSchema } },
    },
  },
});

// `routerFor` gives nothing when a Region has no Trips (e.g. no key for its router), as for /trips.
export function sourceRoutes(
  regions: Region[],
  health: SourceHealthLog,
  clock: () => Date,
  routerFor: (region: Region) => Router | undefined = () => undefined,
) {
  return new OpenAPIHono()
    .openapi(healthRoute, (c) => {
      const now = clock();
      const sources = regions.flatMap((region) =>
        region.sources.map((source) => {
          const record = health.of(source.id);
          return {
            id: source.id,
            region: region.id,
            publisher: source.publisher,
            status: statusOf(source, record, now),
            refreshMinutes: source.refreshMinutes,
            ...(record?.lastSuccessAt ? { lastSuccessAt: record.lastSuccessAt.toISOString() } : {}),
            ...(record?.lastError ? { lastError: { at: record.lastError.at.toISOString(), message: record.lastError.message } } : {}),
          };
        }),
      );
      return c.json({ sources }, 200);
    })
    .openapi(coverageRoute, (c) => {
      const [lat, lon] = c.req.valid("query").near.split(",").map(Number) as [number, number];
      const region = regionAt(regions, lat, lon);
      if (!region) return c.json({ layers: [], sources: [], unavailable: [] }, 200);
      const layers: Layer[] = routerFor(region) ? ["area", "now", "trips"] : ["area", "now"];
      const sources = sourcesAt(region, lat, lon).map(({ id, publisher, license }) => ({ id, publisher, license }));
      return c.json({ region: region.id, layers, sources, unavailable: region.unavailable ?? [] }, 200);
    });
}
