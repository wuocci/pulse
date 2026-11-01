import type { StreetParking } from "@pulse/schema";

// Helsinki's street parking areas (the city's WFS, layer Pysakointipaikat_alue), summed around a place: how many
// spaces, how many paid or free, for electric cars or disabled permits. Helsinki only; elsewhere it finds nothing.

export interface StreetParkingOptions {
  url: string;
  layer: string;
  fetchFn?: typeof fetch;
}

export interface StreetParkingSource {
  around(point: { lat: number; lon: number }, radiusM?: number): Promise<StreetParking | undefined>;
}

const RADIUS_M = 300;
const M_PER_DEG = 111_320;
// Spots that aren't for parking a car: taxis, police, no parking, electric scooters.
const NOT_FOR_CARS = new Set(["Taxi", "Poliisi", "Pysäköintikielto", "Sähköpotkulauta"]);
// The city's classes that are paid parking.
const PAID = new Set([5, 6, 7, 10]);
const FREE_SHORT_TERM = 1;

interface Area {
  geometry: { type: string; coordinates: number[][][] | number[][][][] } | null;
  properties: { luokka: number | null; tyyppi: string | null; paikat_ala: number | null; paikat_des: number | null };
}

export function helsinkiStreetParking({ url, layer, fetchFn = fetch }: StreetParkingOptions): StreetParkingSource {
  return {
    async around({ lat, lon }, radiusM = RADIUS_M) {
      const dLat = radiusM / M_PER_DEG;
      const dLon = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
      const query = new URLSearchParams({
        service: "WFS",
        version: "2.0.0",
        request: "GetFeature",
        typeNames: layer,
        outputFormat: "application/json",
        srsName: "EPSG:4326",
        // This CRS name reads latitude first.
        bbox: [lat - dLat, lon - dLon, lat + dLat, lon + dLon, "urn:ogc:def:crs:EPSG::4326"].join(","),
      });
      const res = await fetchFn(`${url}?${query}`);
      if (!res.ok) throw new Error(`Street parking WFS responded ${res.status}`);
      const { features } = (await res.json()) as { features: Area[] };

      const sum = { spaces: 0, paid: 0, free: 0, ev: 0, accessible: 0 };
      for (const { geometry, properties: p } of features) {
        if (!geometry || NOT_FOR_CARS.has(p.tyyppi ?? "")) continue;
        if (distanceM({ lat, lon }, centreOf(geometry)) > radiusM) continue;
        const spaces = p.paikat_ala ?? Math.round(p.paikat_des ?? 0);
        sum.spaces += spaces;
        if (p.luokka !== null && PAID.has(p.luokka)) sum.paid += spaces;
        if (p.luokka === FREE_SHORT_TERM) sum.free += spaces;
        if (p.tyyppi === "Sähköauto") sum.ev += spaces;
        if (p.tyyppi === "Inva") sum.accessible += spaces;
      }
      return sum.spaces ? { ...sum, radiusM } : undefined;
    },
  };
}

// The middle of an area's outer ring's bounding box.
function centreOf(geometry: NonNullable<Area["geometry"]>): { lat: number; lon: number } {
  const ring = (geometry.type === "MultiPolygon" ? (geometry.coordinates as number[][][][])[0]![0]! : (geometry.coordinates as number[][][])[0]!) ?? [];
  const lons = ring.map((c) => c[0] ?? 0);
  const lats = ring.map((c) => c[1] ?? 0);
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (((b.lon - a.lon) * Math.PI) / 180) * Math.cos((a.lat * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.hypot(x, y) * 6_371_000;
}
