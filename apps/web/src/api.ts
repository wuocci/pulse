import { createClient } from "@pulse/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Time } from "./events.ts";
import type { LatLon } from "./platform.tsx";

// The API's origin. In development it's the Vite dev server, which proxies /v0; a wrapped native app sets
// VITE_API_URL, since it isn't served from the API's origin.
// fetch is looked up per request, not captured once here, so whatever is installed when a request runs (a test's
// mock server, a native HTTP layer) is used.
const client = createClient({
  baseUrl: import.meta.env.VITE_API_URL || window.location.origin,
  fetch: (request) => fetch(request),
});

export function useRegions() {
  return useQuery({
    queryKey: ["regions"],
    queryFn: async () => {
      const { data, response } = await client.GET("/regions");
      if (!data) throw new Error(`GET /regions responded ${response.status}`);
      return data.regions;
    },
    // Regions are configuration: they don't change while the app is open.
    staleTime: Infinity,
  });
}

const DAY_MS = 86_400_000;
// Right now is refreshed while the app is open: things start and stop.
const NOW_REFRESH_MS = 60_000;

// How far around the point both settings of the time switch look.
const RADIUS_M = 1000;

// The Events around a point. Now: the Right now Layer. 14 days: from now to two weeks ahead, including resolved
// ones (e.g. an alert's all-clear).
export function useEvents(point: LatLon | undefined, time: Time) {
  return useQuery({
    queryKey: ["events", point?.lat, point?.lon, time],
    enabled: point !== undefined,
    queryFn: async () => {
      const near = `${point!.lat},${point!.lon},${RADIUS_M}`;
      const now = Date.now();
      const query =
        time === "now"
          ? { near, layer: "now" as const }
          : {
              near,
              from: new Date(now).toISOString(),
              to: new Date(now + 14 * DAY_MS).toISOString(),
              status: "active,upcoming,resolved",
            };
      const { data, response } = await client.GET("/events", { params: { query } });
      if (!data) throw new Error(`GET /events responded ${response.status}`);
      return data.events;
    },
    refetchInterval: time === "now" ? NOW_REFRESH_MS : false,
    // Keep the old pins while the point moves, instead of blinking the map empty.
    placeholderData: keepPreviousData,
  });
}

// Why a search found nothing: the Region has no address search, or the search failed.
export class GeocodeError extends Error {
  readonly reason: "off" | "failed";
  constructor(reason: "off" | "failed") {
    super(`Address search ${reason}`);
    this.reason = reason;
  }
}

// Places matching what's typed, near the point. Nothing until there are two letters.
export function useGeocode(text: string, point: LatLon | undefined, lang: string) {
  const query = text.trim();
  return useQuery({
    queryKey: ["geocode", query, point?.lat, point?.lon, lang],
    enabled: point !== undefined && query.length >= 2,
    queryFn: async () => {
      const { data, response } = await client.GET("/geocode", {
        params: { query: { text: query, near: `${point!.lat},${point!.lon}`, lang } },
      });
      if (!data) throw new GeocodeError(response.status === 503 ? "off" : "failed");
      return data.results;
    },
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

// Every mode's itineraries from A to B, departing now, with the Events on each.
export function useTrip(from: LatLon | undefined, to: LatLon | undefined) {
  return useQuery({
    queryKey: ["trip", from?.lat, from?.lon, to?.lat, to?.lon],
    enabled: from !== undefined && to !== undefined,
    queryFn: async () => {
      const { data, response } = await client.GET("/trips", {
        params: { query: { from: `${from!.lat},${from!.lon}`, to: `${to!.lat},${to!.lon}` } },
      });
      if (!data) throw new Error(`GET /trips responded ${response.status}`);
      return data;
    },
    // The API already asks Digitransit again once.
    retry: false,
    staleTime: 60_000,
  });
}
