import { OpenAPIHono } from "@hono/zod-openapi";
import type { Geocoder } from "./core/adapters/digitransit-geocoding.ts";
import { eventRoutes } from "./core/events/routes.ts";
import type { EventStore } from "./core/events/store.ts";
import { geocodingRoutes } from "./core/geocoding/routes.ts";
import { type Database, healthRoutes } from "./core/health.ts";
import type { Region } from "./core/regions/index.ts";
import { regionRoutes } from "./core/regions/routes.ts";

export interface AppDeps {
  db: Database;
  events: EventStore;
  regions: Region[];
  // "Now" for the Right now Layer; the real time when absent.
  clock?: () => Date;
  // Address search per Region; none when absent.
  geocoderFor?: (region: Region) => Geocoder | undefined;
}

// Portable HTTP layer (AGENTS.md): Web APIs only. Node-specific code is injected through deps.
export function createApp(deps: AppDeps) {
  const v0 = new OpenAPIHono();
  v0.route("/", healthRoutes(deps.db));
  v0.route("/", eventRoutes(deps.events, deps.regions, deps.clock ?? (() => new Date())));
  v0.route("/", regionRoutes(deps.regions));
  v0.route("/", geocodingRoutes(deps.regions, deps.geocoderFor));

  v0.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Pulse API", version: "0.0.0" },
    servers: [{ url: "/v0" }],
  });

  return new OpenAPIHono().route("/v0", v0);
}

export type App = ReturnType<typeof createApp>;
