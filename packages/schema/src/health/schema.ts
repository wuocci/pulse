import { z } from "@hono/zod-openapi";

export const HealthSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    database: z.enum(["ok", "unreachable"]),
  })
  .openapi("Health");
