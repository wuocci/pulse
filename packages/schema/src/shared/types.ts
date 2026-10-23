import type { z } from "@hono/zod-openapi";
import type { GeometrySchema, LocalizedTextSchema } from "./schema.ts";

export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
export type Geometry = z.infer<typeof GeometrySchema>;
