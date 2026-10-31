import { z } from "@hono/zod-openapi";
import { EventSchema } from "../event/schema.ts";

// A Trip (CONTEXT.md): from A to B by a travel mode, departing at a time. Its itineraries are the ways to make it.

export const TravelModeSchema = z.enum(["transit", "walk", "bike"]).openapi("TravelMode");

export const LegModeSchema = z.enum(["walk", "bike", "bus", "tram", "rail", "subway", "ferry", "other"]).openapi("LegMode");

// How much the Events on an itinerary matter for it (Impact in CONTEXT.md). `none`: nothing on the way.
export const ImpactSchema = z.enum(["none", "minor", "consider", "major"]).openapi("Impact");

const TripPlaceSchema = z.object({
  name: z.string().openapi({ example: "Kamppi" }),
  lat: z.number(),
  lon: z.number(),
  stop: z.string().optional().openapi({ description: "The stop's id, when the place is one", example: "HSL:1040601" }),
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
    geometry: z.object({
      type: z.literal("LineString"),
      coordinates: z.array(z.tuple([z.number(), z.number()])).openapi({ description: "[lon, lat] in WGS84" }),
    }),
  })
  .openapi("Leg");

export const ItinerarySchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    durationS: z.number().int(),
    legs: z.array(LegSchema),
    eventIds: z.array(z.string()).openapi({ description: "The Events on this itinerary, from the response's `events`" }),
    impact: ImpactSchema,
  })
  .openapi("Itinerary");

export const TripPlanSchema = z
  .object({ mode: TravelModeSchema, itineraries: z.array(ItinerarySchema).openapi({ description: "Best first; empty when there's no route" }) })
  .openapi("TripPlan");

export const TripSchema = z
  .object({
    events: z.array(EventSchema).openapi({ description: "Every Event on any itinerary, once" }),
    plans: z.array(TripPlanSchema),
    recommended: z
      .object({ mode: TravelModeSchema, index: z.number().int().openapi({ description: "Into that mode's itineraries" }) })
      .optional()
      .openapi({
        description:
          "Better today: when the fastest way has something worth considering in it, the earliest way in any mode that's less in the way and at most 10 min later",
      }),
  })
  .openapi("Trip");
