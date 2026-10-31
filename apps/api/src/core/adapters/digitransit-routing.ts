import type { Itinerary, Leg, LegMode, TravelMode } from "@pulse/schema";

// Trip planning from Digitransit's routing API (OpenTripPlanner 2, GraphQL `planConnection`), for Regions it covers.
// It sometimes answers "no route" wrongly, or hangs (spike in #12): every plan is asked again once before it counts.

export interface RouterOptions {
  url: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface TripRequest {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  mode: TravelMode;
  departAt: string;
}

// An itinerary as planned, before Events are matched to it.
export type RoutedItinerary = Omit<Itinerary, "eventIds" | "impact">;

export interface Router {
  plan(trip: TripRequest): Promise<RoutedItinerary[]>;
}

const TIMEOUT_MS = 10_000;
const TRANSIT_ITINERARIES = 3;
const TRANSIT_MODES = ["BUS", "TRAM", "RAIL", "SUBWAY", "FERRY"].map((mode) => ({ mode }));
const DIRECT = { walk: "WALK", bike: "BICYCLE" } as const;

const QUERY = `query($o: PlanLabeledLocationInput!, $d: PlanLabeledLocationInput!, $t: OffsetDateTime, $modes: PlanModesInput, $first: Int) {
  planConnection(origin: $o, destination: $d, dateTime: { earliestDeparture: $t }, modes: $modes, first: $first) {
    routingErrors { code }
    edges { node { start end duration
      legs { mode
        start { scheduledTime estimated { time } } end { scheduledTime estimated { time } }
        from { name lat lon stop { gtfsId } } to { name lat lon stop { gtfsId } }
        route { gtfsId shortName }
        intermediatePlaces { stop { gtfsId } }
        legGeometry { points } } } }
  }
}`;

interface Time {
  scheduledTime: string;
  estimated: { time: string } | null;
}
interface Place {
  name: string;
  lat: number;
  lon: number;
  stop: { gtfsId: string } | null;
}
interface Answer {
  data?: {
    planConnection: {
      routingErrors: { code: string }[];
      edges: {
        node: {
          start: string;
          end: string;
          duration: number;
          legs: {
            mode: string;
            start: Time;
            end: Time;
            from: Place;
            to: Place;
            route: { gtfsId: string; shortName: string } | null;
            intermediatePlaces: { stop: { gtfsId: string } | null }[] | null;
            legGeometry: { points: string };
          }[];
        };
      }[];
    };
  };
  errors?: { message: string }[];
}

export function digitransitRouter({ url, apiKey, fetchFn = fetch, timeoutMs = TIMEOUT_MS }: RouterOptions): Router {
  async function ask({ from, to, mode, departAt }: TripRequest): Promise<Answer> {
    const location = ({ lat, lon }: TripRequest["from"]) => ({ location: { coordinate: { latitude: lat, longitude: lon } } });
    const variables = {
      o: location(from),
      d: location(to),
      t: departAt,
      ...(mode === "transit"
        ? { modes: { transit: { transit: TRANSIT_MODES } }, first: TRANSIT_ITINERARIES }
        : { modes: { directOnly: true, direct: [DIRECT[mode]] }, first: 1 }),
    };
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "digitransit-subscription-key": apiKey },
      body: JSON.stringify({ query: QUERY, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Digitransit routing responded ${res.status}`);
    const answer = (await res.json()) as Answer;
    if (answer.errors?.length) throw new Error(`Digitransit routing: ${answer.errors.map((e) => e.message).join("; ")}`);
    return answer;
  }

  const routed = (answer: Answer) => answer.data?.planConnection.edges ?? [];

  return {
    async plan(trip) {
      let answer = await ask(trip).catch(() => ask(trip));
      if (!routed(answer).length) answer = await ask(trip);
      return routed(answer).map(({ node }) => ({
        start: node.start,
        end: node.end,
        durationS: Math.round(node.duration),
        legs: node.legs.map(
          (leg): Leg => ({
            mode: legMode(leg.mode),
            ...(leg.route ? { line: { id: leg.route.gtfsId, name: leg.route.shortName } } : {}),
            from: place(leg.from),
            to: place(leg.to),
            start: leg.start.estimated?.time ?? leg.start.scheduledTime,
            end: leg.end.estimated?.time ?? leg.end.scheduledTime,
            // A walk that ends at a stop doesn't pass it: only a line's legs have stops.
            stops: leg.route
              ? [leg.from.stop, ...(leg.intermediatePlaces ?? []).map((p) => p.stop), leg.to.stop].flatMap((s) => (s ? [s.gtfsId] : []))
              : [],
            geometry: { type: "LineString", coordinates: decodePolyline(leg.legGeometry.points) },
          }),
        ),
      }));
    },
  };
}

const LEG_MODES: Record<string, LegMode> = { WALK: "walk", BICYCLE: "bike", BUS: "bus", TRAM: "tram", RAIL: "rail", SUBWAY: "subway", FERRY: "ferry" };
const legMode = (mode: string): LegMode => LEG_MODES[mode] ?? "other";

function place({ name, lat, lon, stop }: Place) {
  return { name, lat, lon, ...(stop ? { stop: stop.gtfsId } : {}) };
}

// Google's encoded polyline, precision 5, as [lon, lat] pairs.
function decodePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    coordinates.push([lon / 1e5, lat / 1e5]);
  }
  return coordinates;
}
