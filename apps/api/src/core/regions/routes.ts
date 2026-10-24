import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { RegionSchema } from "@pulse/schema";
import type { Region } from "./index.ts";

const route = createRoute({
  method: "get",
  path: "/regions",
  responses: {
    200: {
      description: "Regions Pulse covers. Clients use them to bound address search and pick languages.",
      content: { "application/json": { schema: z.object({ regions: z.array(RegionSchema) }) } },
    },
  },
});

export function regionRoutes(regions: Region[]) {
  // Source configs stay internal.
  const body = { regions: regions.map(({ id, name, bbox, timeZone, languages }) => ({ id, name, bbox, timeZone, languages })) };
  return new OpenAPIHono().openapi(route, (c) => c.json(body, 200));
}
