import { OpenAPIHono } from "@hono/zod-openapi";
import { EventSchema } from "@pulse/schema";
import { type Database, healthRoutes } from "./core/health.ts";

export interface AppDeps {
  db: Database;
}

// Portable HTTP layer (AGENTS.md): Web APIs only. Node-specific code is injected through deps.
export function createApp(deps: AppDeps) {
  const v0 = new OpenAPIHono();
  v0.route("/", healthRoutes(deps.db));

  // Not used by a route yet; registered so clients get the Event contract from the spec.
  v0.openAPIRegistry.register("Event", EventSchema);

  v0.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Pulse API", version: "0.0.0" },
    servers: [{ url: "/v0" }],
  });

  return new OpenAPIHono().route("/v0", v0);
}

export type App = ReturnType<typeof createApp>;
