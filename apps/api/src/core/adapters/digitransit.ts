import type { Directory, RouteInfo, StopDirectory, StopInfo } from "./gtfs-rt.ts";

// Stop locations and route names from Digitransit's routing API (GraphQL), for feeds that give only ids.
// Found entries are remembered for the life of the process; unknown ids are asked about again after an hour.

export interface DigitransitOptions {
  url: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  clock?: () => Date;
}

const UNKNOWN_RETRY_MS = 3_600_000;

const QUERY = `query($stops: [String!], $routes: [String!]) {
  stops(ids: $stops) { gtfsId name lat lon }
  routes(ids: $routes) { gtfsId shortName mode }
}`;

interface Answer {
  data?: {
    stops?: ({ gtfsId: string } & StopInfo | null)[];
    routes?: ({ gtfsId: string } & RouteInfo | null)[];
  };
  errors?: { message: string }[];
}

export function digitransitDirectory({ url, apiKey, fetchFn = fetch, clock = () => new Date() }: DigitransitOptions): StopDirectory {
  const stops = new Map<string, StopInfo>();
  const routes = new Map<string, RouteInfo>();
  // id → when it was last found unknown
  const unknown = new Map<string, number>();

  const toAsk = (ids: string[], known: Map<string, unknown>) => {
    const now = clock().getTime();
    return ids.filter((id) => {
      const since = unknown.get(id);
      return !known.has(id) && (since === undefined || now - since >= UNKNOWN_RETRY_MS);
    });
  };

  async function ask(stopIds: string[], routeIds: string[]) {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "digitransit-subscription-key": apiKey },
      body: JSON.stringify({ query: QUERY, variables: { stops: stopIds, routes: routeIds } }),
    });
    if (!res.ok) throw new Error(`Digitransit responded ${res.status}`);
    const { data, errors } = (await res.json()) as Answer;
    if (errors?.length) throw new Error(`Digitransit: ${errors.map((e) => e.message).join("; ")}`);

    const now = clock().getTime();
    for (const stop of data?.stops ?? []) if (stop) stops.set(stop.gtfsId, { name: stop.name, lat: stop.lat, lon: stop.lon });
    for (const route of data?.routes ?? []) if (route) routes.set(route.gtfsId, { shortName: route.shortName, mode: route.mode });
    for (const id of [...stopIds, ...routeIds]) if (!stops.has(id) && !routes.has(id)) unknown.set(id, now);
  }

  return {
    async lookup(ids) {
      const stopIds = toAsk(ids.stops, stops);
      const routeIds = toAsk(ids.routes, routes);
      if (stopIds.length || routeIds.length) {
        // Without an answer, alerts publish with what is remembered: unlocated stops are placed vaguely.
        await ask(stopIds, routeIds).catch((error: unknown) =>
          console.error("Digitransit lookup failed:", error instanceof Error ? error.message : error),
        );
      }
      return { stops: pick(stops, ids.stops), routes: pick(routes, ids.routes) } satisfies Directory;
    },
  };
}

function pick<T>(known: Map<string, T>, ids: string[]): Map<string, T> {
  return new Map(ids.flatMap((id) => (known.has(id) ? [[id, known.get(id)!] as const] : [])));
}
