import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { type Event, type TravelMode, TravelModeSchema, TripSchema } from "@pulse/schema";
import type { Router } from "../adapters/digitransit-routing.ts";
import type { EventStore } from "../events/store.ts";
import { type Region, regionAt } from "../regions/index.ts";
import { impactOf, matchItinerary } from "./match.ts";

const MODES = TravelModeSchema.options;
const MessageSchema = z.object({ message: z.string() });
const latLon = z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "Expected lat,lon");

const route = createRoute({
  method: "get",
  path: "/trips",
  request: {
    query: z.object({
      from: latLon.openapi({ example: "60.1690,24.9316" }),
      to: latLon.openapi({ example: "60.1986,24.9330" }),
      modes: z
        .string()
        .transform((value, ctx) => {
          const parsed = z.array(TravelModeSchema).safeParse(value.split(","));
          if (!parsed.success) {
            ctx.addIssue({ code: "custom", message: `Expected a comma-separated list of ${MODES.join(", ")}` });
            return z.NEVER;
          }
          return parsed.data;
        })
        .optional()
        .openapi({ example: "transit,bike", description: `Comma-separated; default ${MODES.join(",")}` }),
      departAt: z.iso.datetime({ offset: true }).optional().openapi({ description: "Default: now" }),
    }),
  },
  responses: {
    200: {
      description: "Each mode's itineraries, best first, with the Events on each and its Impact",
      content: { "application/json": { schema: TripSchema } },
    },
    400: { description: "A and B aren't in the same Region", content: { "application/json": { schema: MessageSchema } } },
    502: { description: "Planning failed", content: { "application/json": { schema: MessageSchema } } },
    503: { description: "The Region has no Trips", content: { "application/json": { schema: MessageSchema } } },
  },
});

const point = (value: string) => {
  const [lat, lon] = value.split(",").map(Number) as [number, number];
  return { lat, lon };
};

// `routerFor` is absent, or gives nothing, when a Region has no Trips (e.g. no key for its router).
export function tripRoutes(
  store: EventStore,
  regions: Region[],
  clock: () => Date,
  routerFor: (region: Region) => Router | undefined = () => undefined,
) {
  return new OpenAPIHono().openapi(route, async (c) => {
    const query = c.req.valid("query");
    const from = point(query.from);
    const to = point(query.to);
    const region = regionAt(regions, from.lat, from.lon);
    if (!region || regionAt(regions, to.lat, to.lon) !== region) return c.json({ message: "A and B must be in the same Region" }, 400);
    const router = routerFor(region);
    if (!router) return c.json({ message: "Trips are off" }, 503);

    const modes: TravelMode[] = query.modes ?? [...MODES];
    const departAt = query.departAt ?? clock().toISOString();
    let planned;
    try {
      planned = await Promise.all(modes.map(async (mode) => ({ mode, itineraries: await router.plan({ from, to, mode, departAt }) })));
    } catch (error) {
      console.error("Trip planning failed:", error instanceof Error ? error.message : error);
      return c.json({ message: "Trip planning failed" }, 502);
    }

    // What's going on from departure until the last itinerary arrives; the matcher keeps what's on each one.
    const ends = planned.flatMap((p) => p.itineraries.map((i) => Date.parse(i.end)));
    const candidates = ends.length
      ? await store.query({ from: new Date(departAt), to: new Date(Math.max(...ends)), statuses: ["active", "upcoming"] })
      : [];
    const events = new Map<string, Event>();
    const plans = planned.map(({ mode, itineraries }) => ({
      mode,
      itineraries: itineraries.map((itinerary) => {
        const matches = matchItinerary(itinerary, candidates);
        for (const { event } of matches) events.set(event.id, event);
        return { ...itinerary, eventIds: matches.map((m) => m.event.id), impact: impactOf(matches) };
      }),
    }));
    return c.json({ events: [...events.values()], plans }, 200);
  });
}
