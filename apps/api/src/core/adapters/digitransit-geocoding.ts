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
  // The address at a point (an address or a street, within REVERSE_KM), named with its district; none when nothing is.
  reverse(at: { lat: number; lon: number }, lang: string): Promise<GeocodeResult | undefined>;
}

// Farther than this, an address doesn't name the point: a park, the sea.
const REVERSE_KM = 0.25;

const MAX_RESULTS = 5;

interface Answer {
  features: {
    geometry: { type: string; coordinates: number[] };
    properties: { name: string; label: string; distance?: number; neighbourhood?: string; localadmin?: string };
  }[];
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

    async reverse({ lat, lon }, lang) {
      const query = new URLSearchParams({ "point.lat": String(lat), "point.lon": String(lon), size: "1", layers: "address,street", lang });
      const res = await fetchFn(`${url}/reverse?${query}`, { headers: { "digitransit-subscription-key": apiKey } });
      if (!res.ok) throw new Error(`Digitransit geocoding responded ${res.status}`);
      const [feature] = ((await res.json()) as Answer).features;
      if (!feature || feature.geometry.type !== "Point" || (feature.properties.distance ?? 0) > REVERSE_KM) return undefined;
      const { name, neighbourhood, localadmin } = feature.properties;
      const [fLon = lon, fLat = lat] = feature.geometry.coordinates;
      const district = neighbourhood ?? localadmin;
      return { name, label: district ? `${name}, ${district}` : name, lat: fLat, lon: fLon };
    },
  };
}
