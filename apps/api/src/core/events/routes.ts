import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { EventKindSchema, EventSchema, EventStatusSchema, type EventStatus } from "@pulse/schema";
import type { EventStore } from "./store.ts";

const DEFAULT_RADIUS_M = 1000;
const DEFAULT_STATUSES: EventStatus[] = ["active", "upcoming"];

const QuerySchema = z.object({
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?(,\d+)?$/, "Expected lat,lon or lat,lon,radiusInMetres")
    .optional()
    .openapi({ example: "60.1699,24.9384,1000", description: `lat,lon[,radius in metres, default ${DEFAULT_RADIUS_M}]` }),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  kind: EventKindSchema.optional(),
  status: z
    .string()
    .transform((value, ctx) => {
      const parsed = z.array(EventStatusSchema).safeParse(value.split(","));
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "Expected a comma-separated list of upcoming, active, resolved" });
        return z.NEVER;
      }
      return parsed.data;
    })
    .optional()
    .openapi({ example: "active,resolved", description: `Comma-separated; default ${DEFAULT_STATUSES.join(",")}` }),
});

const route = createRoute({
  method: "get",
  path: "/events",
  request: { query: QuerySchema },
  responses: {
    200: {
      description: "Events matching the query",
      content: { "application/json": { schema: z.object({ events: z.array(EventSchema) }) } },
    },
  },
});

export function eventRoutes(store: EventStore) {
  return new OpenAPIHono().openapi(route, async (c) => {
    const { near, from, to, kind, status } = c.req.valid("query");
    const [lat, lon, radius] = near ? near.split(",").map(Number) : [];
    const events = await store.query({
      ...(lat !== undefined && lon !== undefined ? { near: { lat, lon, radiusM: radius ?? DEFAULT_RADIUS_M } } : {}),
      ...(from ? { from: new Date(from) } : {}),
      ...(to ? { to: new Date(to) } : {}),
      ...(kind ? { kind } : {}),
      statuses: status ?? DEFAULT_STATUSES,
    });
    return c.json({ events }, 200);
  });
}
