import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HealthSchema } from "@pulse/schema";

export interface Database {
  ping(): Promise<boolean>;
}

const route = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      description: "Service status. `degraded` means the API runs but the database is unreachable.",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

export function healthRoutes(db: Database) {
  return new OpenAPIHono().openapi(route, async (c) => {
    const reachable = await db.ping().catch(() => false);
    return c.json(
      { status: reachable ? "ok" : "degraded", database: reachable ? "ok" : "unreachable" },
      200,
    );
  });
}
