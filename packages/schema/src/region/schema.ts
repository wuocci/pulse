import { z } from "@hono/zod-openapi";
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
