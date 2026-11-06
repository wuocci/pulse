import type { CarPark } from "@pulse/schema";

type FreeSpaces = NonNullable<CarPark["free"]>;
import { distanceM } from "./street-parking.ts";

// Car parks from Digitransit's routing API (`vehicleParkings`): mostly HSL park-and-ride, so plenty in the suburbs
// and few in the centre. The list is loaded once a day. Some (HSL's park-and-ride system, `liipi:*`) also report
// how many spaces are free: those counts are read every few minutes, when asked for.

export interface CarParksOptions {
  url: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  clock?: () => Date;
}

export interface CarParks {
  near(point: { lat: number; lon: number }, options?: { radiusM?: number; limit?: number }): Promise<CarPark[]>;
}

const RELOAD_MS = 86_400_000;
const LIVE_MS = 5 * 60_000;
// An older count says little about now: none is better than a wrong one.
export const STALE_MS = 30 * 60_000;
// Almost full: this few free, or under this share of the spaces.
const ALMOST_FULL = { spaces: 10, share: 0.05 };

const QUERY = "{ vehicleParkings { vehicleParkingId name lat lon capacity { carSpaces } } }";
const LIVE_QUERY = "{ vehicleParkings { vehicleParkingId realtime availability { carSpaces } } }";

interface Answer {
  data?: {
    vehicleParkings: {
      vehicleParkingId: string;
      name?: string;
      lat?: number;
      lon?: number;
      realtime?: boolean | null;
      capacity?: { carSpaces: number | null } | null;
      availability?: { carSpaces: number | null } | null;
    }[];
  };
}

type Park = Omit<CarPark, "distanceM" | "free"> & { id: string };
type Live = { readAt: Date; free: Map<string, number> };

// Free spaces as read, and whether that's almost full. Without a capacity, by the count alone.
export function freeSpaces(spaces: number, capacity: number | undefined, readAt: Date): FreeSpaces {
  return { spaces, readAt: readAt.toISOString(), almostFull: spaces <= ALMOST_FULL.spaces || (!!capacity && spaces < capacity * ALMOST_FULL.share) };
}

export function digitransitCarParks({ url, apiKey, fetchFn = fetch, clock = () => new Date() }: CarParksOptions): CarParks {
  const ask = async (query: string) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "digitransit-subscription-key": apiKey },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Digitransit car parks responded ${res.status}`);
    return ((await res.json()) as Answer).data?.vehicleParkings ?? [];
  };

  const list = cached(RELOAD_MS, clock, async (): Promise<Park[]> =>
    (await ask(QUERY)).flatMap(({ vehicleParkingId: id, name, lat, lon, capacity }) =>
      capacity?.carSpaces && name && lat !== undefined && lon !== undefined ? [{ id, name, lat, lon, carSpaces: capacity.carSpaces }] : [],
    ),
  );
  // The last counts read stand until fresher ones come: a failed read keeps them, until they're stale.
  let lastLive: Live | undefined;
  const live = cached(LIVE_MS, clock, async (): Promise<Live> => {
    const readAt = clock();
    const parks = await ask(LIVE_QUERY);
    const free = new Map(parks.flatMap((p) => (p.realtime && typeof p.availability?.carSpaces === "number" ? [[p.vehicleParkingId, p.availability.carSpaces] as const] : [])));
    lastLive = { readAt, free };
    return lastLive;
  });

  return {
    async near(point, { radiusM = 1000, limit = 3 } = {}) {
      const parks = (await list())
        .map((park) => ({ ...park, distanceM: Math.round(distanceM(point, park) / 10) * 10 }))
        .filter((park) => park.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, limit);
      // Only asked for when there's a car park to tell about; never holds up the list.
      const counts = parks.length ? await live().catch(() => lastLive) : undefined;
      const fresh = counts && clock().getTime() - counts.readAt.getTime() < STALE_MS ? counts : undefined;
      return parks.map(({ id, ...park }) => {
        const spaces = fresh?.free.get(id);
        return fresh && spaces !== undefined ? { ...park, free: freeSpaces(spaces, park.carSpaces, fresh.readAt) } : park;
      });
    },
  };
}

// One load at a time, kept for `forMs`; a failed one is tried again next time.
function cached<T>(forMs: number, clock: () => Date, load: () => Promise<T>): () => Promise<T> {
  let loaded: { at: number; value: Promise<T> } | undefined;
  return () => {
    const now = clock().getTime();
    if (!loaded || now - loaded.at >= forMs) {
      const attempt = { at: now, value: load() };
      attempt.value.catch(() => {
        if (loaded === attempt) loaded = undefined;
      });
      loaded = attempt;
    }
    return loaded.value;
  };
}
