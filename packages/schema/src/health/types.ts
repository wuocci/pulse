import type { z } from "@hono/zod-openapi";
import type { HealthSchema } from "./schema.ts";

export type Health = z.infer<typeof HealthSchema>;
