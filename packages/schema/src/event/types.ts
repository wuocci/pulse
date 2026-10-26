import type { z } from "@hono/zod-openapi";
import type {
  DailyHoursSchema,
  DeviationSchema,
  EndConflictSchema,
  EventKindSchema,
  EventSchema,
  EventSourceSchema,
  EventStatusSchema,
  LayerSchema,
  MainlyAffectedSchema,
  NoticeableSchema,
  PrecisionSchema,
  SeveritySchema,
  WeekdaySchema,
  WorkTypeSchema,
} from "./schema.ts";

export type EventKind = z.infer<typeof EventKindSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Precision = z.infer<typeof PrecisionSchema>;
export type Noticeable = z.infer<typeof NoticeableSchema>;
export type Weekday = z.infer<typeof WeekdaySchema>;
export type DailyHours = z.infer<typeof DailyHoursSchema>;
export type EventStatus = z.infer<typeof EventStatusSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type Deviation = z.infer<typeof DeviationSchema>;
export type MainlyAffected = z.infer<typeof MainlyAffectedSchema>;
export type WorkType = z.infer<typeof WorkTypeSchema>;
export type EndConflict = z.infer<typeof EndConflictSchema>;
export type Event = z.infer<typeof EventSchema>;
