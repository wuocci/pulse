import { z } from "@hono/zod-openapi";

// A place an address search found, to move the point to. Not a saved Place (CONTEXT.md).
export const GeocodeResultSchema = z
  .object({
    name: z.string().openapi({ example: "Kamppi" }),
    label: z.string().openapi({ description: "The name with enough around it to tell places apart", example: "Kamppi, Kampinkuja 1, Helsinki" }),
    lat: z.number().openapi({ example: 60.169048 }),
    lon: z.number().openapi({ example: 24.931662 }),
  })
  .openapi("GeocodeResult");
