import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { type Event, type TravelMode, TravelModeSchema, type Trip, TripSchema } from "@pulse/schema";
import type { RoutedItinerary, Router } from "../adapters/digitransit-routing.ts";
import type { EventStore } from "../events/store.ts";
import { type Region, regionAt } from "../regions/index.ts";
import { detour } from "./detour.ts";
import { planCar } from "./drive.ts";
import { impactOf, impactOfMatch, matchItinerary, RANK } from "./match.ts";
import { recommend } from "./recommend.ts";

const MODES = TravelModeSchema.options;
// A detour may arrive this much after the drive; it's looked for round this many spots in its way, at most.
const DETOUR_ROOM_MS = 5 * 60_000;
const DETOUR_SPOTS = 2;
// How far ahead a heads-up looks: what starts on the way in the week after the trip.
const COMING_UP_MS = 7 * 86_400_000;
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

// Parking around a place, from whatever Sources the Region has; nothing when it has none.
export interface ParkingFinder {
  // Around `point`, for a car arriving at `arriveAt`.
  near(point: { lat: number; lon: number }, arriveAt: string): Promise<Trip["parking"]>;
}

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
  parkingFor: (region: Region) => ParkingFinder | undefined = () => undefined,
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
    const parkingFinder = parkingFor(region);
    let planned;
    try {
      planned = await Promise.all(
        modes.map(async (mode) => {
          const request = { from, to, mode, departAt };
          return { mode, itineraries: await (mode === "car" ? planCar(router, parkingFinder, request) : router.plan(request)) };
        }),
      );
    } catch (error) {
      console.error("Trip planning failed:", error instanceof Error ? error.message : error);
      return c.json({ message: "Trip planning failed" }, 502);
    }

    // What's going on from departure until the last itinerary arrives (and a detour's few minutes more); the matcher
    // keeps what's on each one.
    const ends = planned.flatMap((p) => p.itineraries.map((i) => Date.parse(i.end)));
    const candidates = ends.length
      ? await store.query({ from: new Date(departAt), to: new Date(Math.max(...ends) + DETOUR_ROOM_MS), statuses: ["active", "upcoming"] })
      : [];
    const matchesOf = (itinerary: RoutedItinerary) => matchItinerary(itinerary, candidates, { timeZone: region.timeZone });
    // What starts on the way later, for a heads-up.
    const aheadUntil = Date.parse(departAt) + COMING_UP_MS;
    const ahead = await store.query({ from: new Date(departAt), to: new Date(aheadUntil), statuses: ["upcoming"] });
    const events = new Map<string, Event>();
    const placed = (match: ReturnType<typeof matchesOf>[number]) => ({
      eventId: match.event.id,
      impact: impactOfMatch(match),
      leg: match.leg,
      at: match.at,
      minutes: match.minutes,
    });
    const withEvents = (itinerary: RoutedItinerary) => {
      const matches = matchesOf(itinerary);
      for (const { event } of matches) events.set(event.id, event);
      const onTheWay = matches.map(placed).sort((a, b) => a.minutes - b.minutes);
      const later = matchItinerary(itinerary, ahead, { window: { start: Date.parse(itinerary.end), end: aheadUntil } }).filter(
        (match) => Date.parse(match.event.when.start) > Date.parse(itinerary.end) && RANK[impactOfMatch(match)] >= RANK.consider,
      );
      for (const { event } of later) events.set(event.id, event);
      const comingUp = later
        .map((match) => ({ ...placed(match), startsAt: match.event.when.start }))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      return { ...itinerary, eventIds: matches.map((m) => m.event.id), onTheWay, comingUp, impact: impactOf(matches) };
    };
    const plans = planned.map(({ mode, itineraries }) => ({ mode, itineraries: itineraries.map(withEvents) }));

    // Something in the drive's way: steer round it — the first spot, else the next — and offer that as better today.
    const car = plans.find((p) => p.mode === "car");
    const first = car?.itineraries[0];
    const spots = first?.legs.every((leg) => leg.mode === "car") ? first.onTheWay.filter((m) => RANK[m.impact] >= RANK.consider).slice(0, DETOUR_SPOTS) : [];
    const assess = (itinerary: RoutedItinerary) => {
      const matches = matchesOf(itinerary);
      return { impact: impactOf(matches), inTheWay: matches.filter((m) => RANK[impactOfMatch(m)] >= RANK.consider).length };
    };
    let around: RoutedItinerary | undefined;
    for (const spot of first ? spots : []) {
      around = await detour(router, { from, to, mode: "car", departAt }, first!, [spot.at[0] ?? 0, spot.at[1] ?? 0], assess).catch(() => undefined);
      if (around) break;
    }
    if (car && around) car.itineraries.splice(1, 0, withEvents(around));
    const recommended = recommend(plans) ?? (around ? { mode: "car" as const, index: 1 } : undefined);
    // Where to leave the car, when there's a way to drive: a suggestion, so it never holds up the Trip.
    const drive = plans.find((p) => p.mode === "car")?.itineraries[0];
    const parking = drive
      ? await parkingFinder
          ?.near(to, drive.end)
          .catch((error: unknown) => console.error("Parking lookup failed:", error instanceof Error ? error.message : error))
      : undefined;
    return c.json({ events: [...events.values()], plans, ...(parking ? { parking } : {}), ...(recommended ? { recommended } : {}) }, 200);
  });
}
