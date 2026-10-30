import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { GeocodeResultSchema } from "@pulse/schema";
import type { Geocoder } from "../adapters/digitransit-geocoding.ts";
import { type Region, regionAt } from "../regions/index.ts";

const MessageSchema = z.object({ message: z.string() });

const route = createRoute({
  method: "get",
  path: "/geocode",
  request: {
    query: z.object({
      text: z.string().trim().min(2).max(100).openapi({ example: "kampp", description: "What the reader has typed so far" }),
      near: z
        .string()
        .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "Expected lat,lon")
        .openapi({ example: "60.1699,24.9384", description: "lat,lon: picks the Region, and nearer places rank first" }),
      lang: z.string().optional().openapi({ example: "fi", description: "The reader's language; the Region's main language when it doesn't speak it" }),
    }),
  },
  responses: {
    200: {
      description: "Places in the Region at `near` matching the text, best first. None outside every Region.",
      content: { "application/json": { schema: z.object({ results: z.array(GeocodeResultSchema) }) } },
    },
    502: { description: "The geocoder failed", content: { "application/json": { schema: MessageSchema } } },
    503: { description: "The Region has no address search", content: { "application/json": { schema: MessageSchema } } },
  },
});

// `geocoderFor` is absent, or gives nothing, when a Region has no address search (e.g. no key for its geocoder).
export function geocodingRoutes(regions: Region[], geocoderFor: (region: Region) => Geocoder | undefined = () => undefined) {
  return new OpenAPIHono().openapi(route, async (c) => {
    const { text, near, lang } = c.req.valid("query");
    const [lat, lon] = near.split(",").map(Number) as [number, number];
    const region = regionAt(regions, lat, lon);
    if (!region) return c.json({ results: [] }, 200);
    const geocoder = geocoderFor(region);
    if (!geocoder) return c.json({ message: "Address search is off" }, 503);

    try {
      const results = await geocoder.search(text, {
        focus: { lat, lon },
        bbox: region.bbox,
        lang: lang && region.languages.includes(lang) ? lang : region.languages[0]!,
      });
      return c.json({ results }, 200);
    } catch (error) {
      console.error("Geocoding failed:", error instanceof Error ? error.message : error);
      return c.json({ message: "Address search failed" }, 502);
    }
  });
}
