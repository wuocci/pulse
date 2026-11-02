import type { CarPark } from "@pulse/schema";
import { distanceM } from "./street-parking.ts";

// Car parks from Digitransit's routing API (`vehicleParkings`): mostly HSL park-and-ride, so plenty in the suburbs
// and few in the centre. Static (no live availability), so the list is loaded once a day.

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
const QUERY = "{ vehicleParkings { name lat lon capacity { carSpaces } } }";

interface Answer {
  data?: { vehicleParkings: { name: string; lat: number; lon: number; capacity: { carSpaces: number | null } | null }[] };
}

export function digitransitCarParks({ url, apiKey, fetchFn = fetch, clock = () => new Date() }: CarParksOptions): CarParks {
  let loaded: { at: number; parks: Promise<Omit<CarPark, "distanceM">[]> } | undefined;

  const load = async () => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "digitransit-subscription-key": apiKey },
      body: JSON.stringify({ query: QUERY }),
    });
    if (!res.ok) throw new Error(`Digitransit car parks responded ${res.status}`);
    const { data } = (await res.json()) as Answer;
    return (data?.vehicleParkings ?? []).flatMap(({ name, lat, lon, capacity }) =>
      capacity?.carSpaces ? [{ name, lat, lon, carSpaces: capacity.carSpaces }] : [],
    );
  };

  // One load at a time, kept for a day; a failed one is tried again next time.
  const parks = () => {
    const now = clock().getTime();
    if (!loaded || now - loaded.at >= RELOAD_MS) {
      const attempt = { at: now, parks: load() };
      attempt.parks.catch(() => {
        if (loaded === attempt) loaded = undefined;
      });
      loaded = attempt;
    }
    return loaded.parks;
  };

  return {
    async near(point, { radiusM = 1000, limit = 3 } = {}) {
      return (await parks())
        .map((park) => ({ ...park, distanceM: Math.round(distanceM(point, park) / 10) * 10 }))
        .filter((park) => park.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, limit);
    },
  };
}
