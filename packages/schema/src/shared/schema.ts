import { z } from "@hono/zod-openapi";

// Text keyed by BCP 47 language tag, e.g. { "en": "…", "fi": "…" }.
export const LocalizedTextSchema = z
  .record(z.string(), z.string())
  .openapi("LocalizedText", { example: { en: "Excavation · Hämeentie 12 · until 14 Nov" } });

const PositionSchema = z.array(z.number()).min(2).max(3);

// GeoJSON geometry in WGS84 (RFC 7946). Coordinates are validated for shape only.
export const GeometrySchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("Point"), coordinates: PositionSchema }),
    z.object({ type: z.literal("MultiPoint"), coordinates: z.array(PositionSchema) }),
    z.object({ type: z.literal("LineString"), coordinates: z.array(PositionSchema) }),
    z.object({
      type: z.literal("MultiLineString"),
      coordinates: z.array(z.array(PositionSchema)),
    }),
    z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(PositionSchema)) }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(z.array(z.array(PositionSchema))),
    }),
  ])
  .openapi("Geometry");
