import { z } from "@hono/zod-openapi";
import { GeometrySchema, LocalizedTextSchema } from "../shared/schema.ts";

// Vocabulary follows CONTEXT.md. Keep Severity (general) and Impact (per Watch) apart.

export const EventKindSchema = z
  .enum(["disruption", "works", "closure", "weather", "public_event", "anomaly"])
  .openapi("EventKind");

export const LayerSchema = z.enum(["trips", "area", "now"]).openapi("Layer");

export const SeveritySchema = z.enum(["info", "minor", "consider", "major"]).openapi("Severity");

export const PrecisionSchema = z
  .enum(["exact", "segment", "area", "vague"])
  .openapi("Precision");

export const EventStatusSchema = z
  .enum(["upcoming", "active", "resolved"])
  .openapi("EventStatus");

// What a person standing nearby would sense. A set: a demonstration is both crowd and noise.
export const NoticeableSchema = z
  .enum(["noise", "crowd", "sirens", "blocked", "aircraft", "outage"])
  .openapi("Noticeable");

export const WeekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]).openapi("Weekday");

// Local time of day, "00:00" to "24:00".
const TimeOfDaySchema = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "Expected HH:MM");

export const DailyHoursSchema = z
  .object({
    from: TimeOfDaySchema.openapi({ example: "09:00" }),
    to: TimeOfDaySchema.openapi({ example: "15:00", description: "Exclusive. Earlier than `from` means past midnight." }),
    days: z.array(WeekdaySchema).min(1).optional().openapi({
      description: "Days the hours start on; every day when absent",
    }),
  })
  .openapi("DailyHours", {
    description: "Hours of each day the Event is going on, in the local time of the Region it is in",
  });

export const EventSourceSchema = z
  .object({
    name: z.string().openapi({ example: "City of Helsinki" }),
    id: z.string().openapi({ description: "The item's id at the Source" }),
    url: z.url().optional(),
    updatedAt: z.iso.datetime({ offset: true }),
    license: z.string().openapi({ example: "CC BY 4.0" }),
    attribution: z.string().optional(),
  })
  .openapi("EventSource");

export const DeviationSchema = z
  .object({
    metric: z.enum(["speed", "delay", "travel_time"]),
    normal: z.number(),
    now: z.number(),
    unit: z.string().openapi({ example: "s" }),
  })
  .openapi("Deviation");

export const EventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_01JB2Z8Q4M" }),
    kind: EventKindSchema,
    layers: z.array(LayerSchema),
    title: LocalizedTextSchema,
    originalText: LocalizedTextSchema.optional().openapi({
      description: "The Source's own text, unchanged",
    }),
    where: z.object({
      geometry: GeometrySchema,
      precision: PrecisionSchema,
      lines: z.array(z.string()).optional(),
      stops: z.array(z.string()).optional(),
    }),
    when: z.object({
      start: z.iso.datetime({ offset: true }),
      end: z.iso.datetime({ offset: true }).optional(),
      dailyHours: DailyHoursSchema.optional().openapi({
        description: "The Source's own daily hours. When absent, the Right now Layer uses defaults for the kind.",
      }),
    }),
    severity: SeveritySchema,
    noticeable: z.array(NoticeableSchema).openapi({ description: "May be empty: nothing to sense on site" }),
    deviation: DeviationSchema.optional(),
    status: EventStatusSchema,
    clusterId: z.string().optional().openapi({
      description: "Set when this Event shares a real-world cause with Events from other Sources",
    }),
    sources: z.array(EventSourceSchema).min(1),
    confidence: z.number().min(0).max(1).openapi({
      description: "Confidence in the structured fields; 0 means not yet classified",
    }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .openapi("Event");
