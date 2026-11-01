import type { z } from "@hono/zod-openapi";
import type { CarParkSchema, ImpactSchema, StreetParkingSchema, ItinerarySchema, LegModeSchema, LegSchema, TravelModeSchema, TripPlanSchema, TripSchema } from "./schema.ts";

export type TravelMode = z.infer<typeof TravelModeSchema>;
export type LegMode = z.infer<typeof LegModeSchema>;
export type Impact = z.infer<typeof ImpactSchema>;
export type Leg = z.infer<typeof LegSchema>;
export type Itinerary = z.infer<typeof ItinerarySchema>;
export type TripPlan = z.infer<typeof TripPlanSchema>;
export type Trip = z.infer<typeof TripSchema>;
export type CarPark = z.infer<typeof CarParkSchema>;
export type StreetParking = z.infer<typeof StreetParkingSchema>;
