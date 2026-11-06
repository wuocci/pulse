import { z } from "@hono/zod-openapi";
import { EventSchema } from "../event/schema.ts";

// A Trip (CONTEXT.md): from A to B by a travel mode, departing at a time. Its itineraries are the ways to make it.

export const TravelModeSchema = z
  .enum(["transit", "walk", "bike", "car"])
  .openapi("TravelMode", { description: "car: free-flow times, without traffic" });

export const LegModeSchema = z.enum(["walk", "bike", "car", "bus", "tram", "rail", "subway", "ferry", "other"]).openapi("LegMode");

// How much the Events on an itinerary matter for it (Impact in CONTEXT.md). `none`: nothing on the way.
export const ImpactSchema = z.enum(["none", "minor", "consider", "major"]).openapi("Impact");

const TripPlaceSchema = z.object({
  name: z.string().openapi({ example: "Kamppi" }),
  lat: z.number(),
  lon: z.number(),
  stop: z.string().optional().openapi({ description: "The stop's id, when the place is one", example: "HSL:1040601" }),
  parking: z.string().optional().openapi({ description: "The car park, when a car leg ends at one (park-and-ride)", example: "Niittykumpu" }),
  parkingSpaces: z.number().int().optional().openapi({ description: "The car park's spaces for cars, when known" }),
});

export const LegSchema = z
  .object({
    mode: LegModeSchema,
    line: z
      .object({ id: z.string().openapi({ example: "HSL:31M1" }), name: z.string().openapi({ example: "M1" }) })
      .optional()
      .openapi({ description: "The line a transit leg rides" }),
    from: TripPlaceSchema,
    to: TripPlaceSchema,
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    stops: z.array(z.string()).openapi({ description: "Ids of the stops a transit leg passes, first to last" }),
    distanceM: z.number().int().optional().openapi({ description: "Along the leg's line" }),
    geometry: z.object({
      type: z.literal("LineString"),
      coordinates: z.array(z.tuple([z.number(), z.number()])).openapi({ description: "[lon, lat] in WGS84" }),
    }),
  })
  .openapi("Leg");

export const OnTheWaySchema = z
  .object({
    eventId: z.string(),
    impact: ImpactSchema.openapi({ description: "How much this Event matters for this itinerary" }),
    leg: z.number().int().openapi({ description: "Index of the first leg it's on" }),
    at: z.tuple([z.number(), z.number()]).openapi({ description: "[lon, lat] on the route where the trip meets it" }),
    minutes: z.number().int().openapi({ description: "Minutes from the itinerary's start to `at`" }),
    wholeWay: z.boolean().optional().openapi({ description: "An area the itinerary starts and ends in: on the whole way, not one part of it" }),
    crowd: z
      .object({
        at: z.enum(["start", "end"]).openapi({ description: "The crowd arriving as the event starts, or leaving as it ends" }),
        time: z.iso.datetime({ offset: true }).openapi({ description: "When it starts or ends; an end is often estimated" }),
      })
      .optional()
      .openapi({ description: "Met in a big event's crowd as it starts or ends: worth considering" }),
  })
  .openapi("OnTheWay");

export const ItinerarySchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    durationS: z.number().int(),
    legs: z.array(LegSchema),
    eventIds: z.array(z.string()).openapi({ description: "The Events on this itinerary, from the response's `events`" }),
    onTheWay: z
      .array(OnTheWaySchema)
      .openapi({ description: "Where and how each of `eventIds` is on the itinerary, in the order the trip reaches them" }),
    comingUp: z
      .array(OnTheWaySchema.extend({ startsAt: z.iso.datetime({ offset: true }) }))
      .openapi({
        description:
          "A heads-up: what would be in this way (worth considering or major) and starts in the 7 days after it, soonest first. Its Events are in the response's `events` too",
      }),
    impact: ImpactSchema,
  })
  .openapi("Itinerary");

export const TripPlanSchema = z
  .object({ mode: TravelModeSchema, itineraries: z.array(ItinerarySchema).openapi({ description: "Best first; empty when there's no route" }) })
  .openapi("TripPlan");

// A car park with spaces for cars (mostly park-and-ride), near a Trip's destination. Static: no live availability.
export const CarParkSchema = z
  .object({
    name: z.string().openapi({ example: "Matinkylän asema" }),
    lat: z.number(),
    lon: z.number(),
    carSpaces: z.number().int(),
    distanceM: z.number().int().openapi({ description: "As the crow flies from the destination" }),
  })
  .openapi("CarPark");

// The street parking around a Trip's destination, summed: how many spaces and of which kind. Static rules, not
// whether they're free right now.
export const StreetParkingSchema = z
  .object({
    spaces: z.number().int(),
    paid: z.number().int(),
    free: z.number().int().openapi({ description: "Free short-term parking" }),
    ev: z.number().int().openapi({ description: "For electric cars" }),
    accessible: z.number().int().openapi({ description: "For disabled parking permits" }),
    radiusM: z.number().int(),
    places: z
      .array(
        z.object({
          lat: z.number(),
          lon: z.number(),
          spaces: z.number().int(),
          kind: z.enum(["paid", "free", "other"]).openapi({ description: "other: only for some cars (`type`)" }),
          type: z.enum(["ev", "accessible"]).optional(),
          cost: z.enum(["free", "paid"]).optional().openapi({ description: "On arrival, as a pick's; absent for `other`" }),
          perHour: z.number().optional(),
          paidUntil: z.string().optional(),
          freeUntil: z.string().optional(),
          maxStayMin: z.number().int().optional(),
          disc: z.boolean(),
        }),
      )
      .openapi({ description: "Each parking area's centre and what it costs on arrival, for the map" }),
  })
  .openapi("StreetParking");

export const ParkingPickSchema = z
  .object({
    reasons: z.array(z.enum(["closest", "cheapest", "biggest"])).openapi({ description: "Why it's picked: one spot can be several" }),
    kind: z.enum(["street", "carPark"]),
    name: z.string().optional().openapi({ description: "A car park's name" }),
    lat: z.number(),
    lon: z.number(),
    distanceM: z.number().int().openapi({ description: "As the crow flies from the destination" }),
    spaces: z.number().int(),
    cost: z.enum(["free", "paid", "unknown"]).openapi({ description: "On arrival: free also when it's outside the paid hours" }),
    perHour: z.number().optional().openapi({ description: "Euros an hour, from the fee zone, when it's paid" }),
    paidUntil: z.string().optional().openapi({ description: "When the paid hours end on the day of arrival, as HH:MM", example: "21:00" }),
    freeUntil: z.string().optional().openapi({ description: "When the paid hours begin, if it's free on arrival but not all day", example: "09:00" }),
    maxStayMin: z.number().int().optional(),
    disc: z.boolean().openapi({ description: "A parking disc is needed" }),
  })
  .openapi("ParkingPick");

export const TripSchema = z
  .object({
    events: z.array(EventSchema).openapi({ description: "Every Event on any itinerary, once" }),
    plans: z.array(TripPlanSchema),
    parking: z
      .object({
        street: StreetParkingSchema.optional(),
        carParks: z.array(CarParkSchema).openapi({ description: "Nearest first, within a kilometre" }),
        sources: z.array(z.string()).openapi({ description: "Where the parking data comes from, to credit it" }),
        picks: z
          .array(ParkingPickSchema)
          .openapi({ description: "Where to park on arrival: the closest spot, the cheapest, and the car park with the most spaces" }),
      })
      .optional()
      .openapi({ description: "Parking around B on arrival by car: static, not whether spaces are free now" }),
    recommended: z
      .object({ mode: TravelModeSchema, index: z.number().int().openapi({ description: "Into that mode's itineraries" }) })
      .optional()
      .openapi({
        description:
          "Better today: when the fastest way has something worth considering in it, the earliest way in any mode that's less in the way and at most 10 min later",
      }),
  })
  .openapi("Trip");
