import { createRootRoute, createRoute, createRouter, Outlet, type RouterHistory } from "@tanstack/react-router";
import { z } from "zod";
import { Home } from "./Home.tsx";

// The view lives in the URL, so a reload, a shared link or a push deep link lands on the same thing.
// A malformed value is dropped rather than failing the page.
const SearchSchema = z.object({
  at: z.string().optional().catch(undefined),
  // The time switch; Now when absent.
  time: z.enum(["now", "14d"]).optional().catch(undefined),
  // The selected Event's id.
  event: z.string().optional().catch(undefined),
  // Trip mode, and the Trip: To (and From, else the point) as lat,lon with the name the search gave.
  trip: z.boolean().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  toName: z.string().optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  fromName: z.string().optional().catch(undefined),
  // The chosen travel mode; public transport when absent.
  mode: z.enum(["transit", "walk", "bike"]).optional().catch(undefined),
});

const rootRoute = createRootRoute({ component: Outlet });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", validateSearch: SearchSchema, component: Home });

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree: rootRoute.addChildren([homeRoute]), ...(history ? { history } : {}) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
