import { createRootRoute, createRoute, createRouter, Outlet, type RouterHistory } from "@tanstack/react-router";
import { z } from "zod";
import { Home } from "./Home.tsx";

// The view lives in the URL, so a reload, a shared link or a push deep link lands on the same thing.
// A malformed value is dropped rather than failing the page.
const SearchSchema = z.object({
  at: z.string().optional().catch(undefined),
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
