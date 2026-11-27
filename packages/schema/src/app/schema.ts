import { z } from "@hono/zod-openapi";
import { WeekdaySchema } from "../event/schema.ts";
import { ItinerarySchema, TravelModeSchema } from "../trip/schema.ts";

// The app module's types (ADR 0010, 0013): a Device and its Routines. Served under /app, not /v0.

// A Routine's time on one weekday, on the Region's clock: when to leave, or when to be there.
export const RoutineTimeSchema = z
  .object({
    kind: z.enum(["leaveAt", "arriveBy"]),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM"),
  })
  .openapi("RoutineTime");

const RoutineEndSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().min(1).max(80),
});

// The Usual route (CONTEXT.md): the way the Routine normally takes at its scheduled time, picked when it's saved.
export const UsualRouteSchema = z.object({ mode: TravelModeSchema, itinerary: ItinerarySchema }).openapi("UsualRoute");

export const RoutineInputSchema = z
  .object({
    from: RoutineEndSchema,
    to: RoutineEndSchema,
    modes: z.array(TravelModeSchema).min(1),
    days: z
      .partialRecord(WeekdaySchema, RoutineTimeSchema)
      .refine((days) => Object.keys(days).length > 0, "At least one weekday"),
    usual: UsualRouteSchema,
  })
  .openapi("RoutineInput");

export const RoutineSchema = RoutineInputSchema.extend({
  id: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  renewedAt: z.iso.datetime({ offset: true }).openapi({ description: "When the app last said it still uses this Routine" }),
}).openapi("Routine");

export const DeviceSchema = z.object({ id: z.string().openapi({ description: "Send it as the X-Pulse-Device header" }) }).openapi("Device");
