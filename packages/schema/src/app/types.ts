import type { z } from "@hono/zod-openapi";
import type { DeviceSchema, RoutineInputSchema, RoutineSchema, RoutineTimeSchema, UsualRouteSchema } from "./schema.ts";

export type RoutineTime = z.infer<typeof RoutineTimeSchema>;
export type UsualRoute = z.infer<typeof UsualRouteSchema>;
export type RoutineInput = z.infer<typeof RoutineInputSchema>;
export type Routine = z.infer<typeof RoutineSchema>;
export type Device = z.infer<typeof DeviceSchema>;
