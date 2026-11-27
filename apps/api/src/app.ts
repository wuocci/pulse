import { OpenAPIHono } from "@hono/zod-openapi";
import { appRoutes } from "./app/routes.ts";
import type { AppStore } from "./app/store.ts";
import type { Geocoder } from "./core/adapters/digitransit-geocoding.ts";
import type { Router } from "./core/adapters/digitransit-routing.ts";
import { eventRoutes } from "./core/events/routes.ts";
import type { EventStore } from "./core/events/store.ts";
import { geocodingRoutes } from "./core/geocoding/routes.ts";
import { type Database, healthRoutes } from "./core/health.ts";
import { InMemorySourceHealthLog, type SourceHealthLog } from "./core/ingest/health.ts";
import type { Region } from "./core/regions/index.ts";
import { regionRoutes } from "./core/regions/routes.ts";
import { sourceRoutes } from "./core/sources/routes.ts";
import { type ParkingFinder, tripRoutes } from "./core/trips/routes.ts";

export interface AppDeps {
  db: Database;
  events: EventStore;
  regions: Region[];
  // How ingest's refreshes went; with none, no Source has updated yet.
  sourceHealth?: SourceHealthLog;
  // "Now" for the Right now Layer; the real time when absent.
  clock?: () => Date;
  // Address search per Region; none when absent.
  geocoderFor?: (region: Region) => Geocoder | undefined;
  // Trip planning per Region; no Trips when absent.
  routerFor?: (region: Region) => Router | undefined;
  // Parking near a Trip's destination per Region; none when absent.
  parkingFor?: (region: Region) => ParkingFinder | undefined;
  // The app module's Devices and Routines (ADR 0010, 0013); no /app routes when absent.
  appStore?: AppStore;
}

// Portable HTTP layer (AGENTS.md): Web APIs only. Node-specific code is injected through deps.
export function createApp(deps: AppDeps) {
  const v0 = new OpenAPIHono();
  v0.route("/", healthRoutes(deps.db));
  v0.route("/", eventRoutes(deps.events, deps.regions, deps.clock ?? (() => new Date())));
  v0.route("/", regionRoutes(deps.regions));
  v0.route("/", geocodingRoutes(deps.regions, deps.geocoderFor));
  v0.route("/", tripRoutes(deps.events, deps.regions, deps.clock ?? (() => new Date()), deps.routerFor, deps.parkingFor));
  v0.route("/", sourceRoutes(deps.regions, deps.sourceHealth ?? new InMemorySourceHealthLog(), deps.clock ?? (() => new Date()), deps.routerFor));

  v0.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Pulse API", version: "0.0.0" },
    servers: [{ url: "/v0" }],
  });

  // /app is the Pulse app's own group, outside the public /v0 contract and its OpenAPI document.
  const root = new OpenAPIHono().route("/v0", v0);
  return deps.appStore ? root.route("/app", appRoutes(deps.appStore, deps.clock ?? (() => new Date()))) : root;
}

export type App = ReturnType<typeof createApp>;
