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
    }),
    severity: SeveritySchema,
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
