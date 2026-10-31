import type { GeocodeResult } from "@pulse/schema";

// Address search from Digitransit's geocoding API (Pelias), for Regions it covers.

export interface GeocoderOptions {
  url: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}

export interface GeocodeSearch {
  // Results near here rank first.
  focus: { lat: number; lon: number };
  // [minLon, minLat, maxLon, maxLat]: nothing outside the Region.
  bbox: readonly [number, number, number, number];
  lang: string;
}

export interface Geocoder {
  search(text: string, search: GeocodeSearch): Promise<GeocodeResult[]>;
}

const MAX_RESULTS = 5;

interface Answer {
  features: { geometry: { type: string; coordinates: number[] }; properties: { name: string; label: string } }[];
}

export function digitransitGeocoder({ url, apiKey, fetchFn = fetch }: GeocoderOptions): Geocoder {
  return {
    async search(text, { focus, bbox: [minLon, minLat, maxLon, maxLat], lang }) {
      const query = new URLSearchParams({
        text,
        lang,
        "focus.point.lat": String(focus.lat),
        "focus.point.lon": String(focus.lon),
        "boundary.rect.min_lon": String(minLon),
        "boundary.rect.min_lat": String(minLat),
        "boundary.rect.max_lon": String(maxLon),
        "boundary.rect.max_lat": String(maxLat),
      });
      const res = await fetchFn(`${url}/autocomplete?${query}`, { headers: { "digitransit-subscription-key": apiKey } });
      if (!res.ok) throw new Error(`Digitransit geocoding responded ${res.status}`);
      const { features } = (await res.json()) as Answer;

      // A stop has a feature per platform, all with the same label: one is enough to move the map.
      const byLabel = new Map<string, GeocodeResult>();
      for (const { geometry, properties } of features) {
        if (geometry.type !== "Point" || byLabel.has(properties.label)) continue;
        const [lon = 0, lat = 0] = geometry.coordinates;
        byLabel.set(properties.label, { name: properties.name, label: properties.label, lat, lon });
      }
      return [...byLabel.values()].slice(0, MAX_RESULTS);
    },
  };
}
