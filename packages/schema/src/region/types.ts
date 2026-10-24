import type { z } from "@hono/zod-openapi";
import type { RegionSchema } from "./schema.ts";

export type Region = z.infer<typeof RegionSchema>;
