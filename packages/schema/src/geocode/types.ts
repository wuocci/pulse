import type { z } from "@hono/zod-openapi";
import type { GeocodeResultSchema } from "./schema.ts";

export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;
