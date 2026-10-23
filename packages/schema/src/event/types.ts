import type { z } from "@hono/zod-openapi";
import type {
  DeviationSchema,
  EventKindSchema,
  EventSchema,
  EventSourceSchema,
  EventStatusSchema,
  LayerSchema,
  PrecisionSchema,
  SeveritySchema,
} from "./schema.ts";

export type EventKind = z.infer<typeof EventKindSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Precision = z.infer<typeof PrecisionSchema>;
export type EventStatus = z.infer<typeof EventStatusSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type Deviation = z.infer<typeof DeviationSchema>;
export type Event = z.infer<typeof EventSchema>;
