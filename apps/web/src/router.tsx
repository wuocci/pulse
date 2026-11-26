import { createRootRoute, createRoute, createRouter, Outlet, redirect, type RouterHistory } from "@tanstack/react-router";
import { z } from "zod";
import { Around } from "./Around.tsx";

// The view lives in the URL, so a reload, a shared link or a push deep link lands on the same thing.
// A malformed value is dropped rather than failing the page.
const SearchSchema = z.object({
  at: z.string().optional().catch(undefined),
  // The time switch; Now when absent.
  // "now", or a picked time on the device's clock, as a datetime-local input gives it.
  time: z.union([z.literal("now"), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]).optional().catch(undefined),
  // On a Trip: the time is when to arrive by, not when to leave.
  arrive: z.boolean().optional().catch(undefined),
  // The selected Event's id.
  event: z.string().optional().catch(undefined),
  // Trip mode, and the Trip: To (and From, else the point) as lat,lon with the name the search gave.
  trip: z.boolean().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  toName: z.string().optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  fromName: z.string().optional().catch(undefined),
  // The chosen travel mode; public transport when absent.
  mode: z.enum(["transit", "walk", "bike", "car"]).optional().catch(undefined),
  // Which of that mode's itineraries; the recommended one, else the first, when absent.
  route: z.number().int().min(0).optional().catch(undefined),
});

const rootRoute = createRootRoute({ component: Outlet });
// One screen (2026-11-26, Home folded into Around): where to, your places and only what changes plans near them,
// then what's going on around a point, on the list and the map; Trips open in place.
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", validateSearch: SearchSchema, component: Around });
// Where Around was: old links and bookmarks land on the same view.
const aroundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/around",
  validateSearch: SearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search, replace: true });
  },
});

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree: rootRoute.addChildren([homeRoute, aroundRoute]), ...(history ? { history } : {}) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
