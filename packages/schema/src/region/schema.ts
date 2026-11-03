import { z } from "@hono/zod-openapi";
import { LayerSchema } from "../event/schema.ts";
import { LocalizedTextSchema } from "../shared/schema.ts";

// A named area Pulse covers (CONTEXT.md). Events don't belong to a Region; matching is by geometry only.
export const RegionSchema = z
  .object({
    id: z.string().openapi({ example: "fi-capital-region" }),
    name: LocalizedTextSchema,
    bbox: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .openapi({ description: "[minLon, minLat, maxLon, maxLat] in WGS84", example: [24.4, 60.0, 25.3, 60.45] }),
    timeZone: z.string().openapi({ description: "IANA time zone", example: "Europe/Helsinki" }),
    languages: z
      .array(z.string())
      .min(1)
      .openapi({ description: "BCP 47 tags, the main language first", example: ["fi", "sv", "en"] }),
  })
  .openapi("Region");

// Which Layers and Sources there are at a point (CONTEXT.md), so a client can tell "nothing is happening" apart
// from "we don't know about this place".
export const CoverageSchema = z
  .object({
    region: z.string().optional().openapi({ description: "The Region's id; absent outside every Region", example: "fi-capital-region" }),
    layers: z.array(LayerSchema),
    sources: z.array(z.object({ id: z.string(), publisher: z.string(), license: z.string() })),
    unavailable: z
      .array(z.object({ id: z.string(), name: LocalizedTextSchema, reason: LocalizedTextSchema }))
      .openapi({ description: "What the Region has no Source for, so its absence isn't read as nothing going on" }),
  })
  .openapi("Coverage");
