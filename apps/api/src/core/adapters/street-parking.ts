// Helsinki's street parking spots (kartta.hel.fi WFS), with who may park there, when and for how long, and the
// price per hour of the fee zone each is in. The city's classes (`luokka`) say what a spot is; special spots
// (taxi, loading, scooters…) have no class but a type (`tyyppi`).

export interface StreetParkingOptions {
  url: string;
  layer: string;
  zonesLayer?: string;
  fetchFn?: typeof fetch;
}

// Minutes since midnight, from–to, on weekdays, Saturdays and Sundays; a day left out has none.
export interface WeekHours {
  weekdays?: [number, number];
  sat?: [number, number];
  sun?: [number, number];
}

export interface StreetSpot {
  lat: number;
  lon: number;
  distanceM: number;
  spaces: number;
  // other: only for some cars (`type`).
  kind: "paid" | "free" | "other";
  type?: "ev" | "accessible";
  maxStayMin?: number;
  // A parking disc is needed.
  disc: boolean;
  // When it's paid; a paid spot without hours is paid all the time.
  paidHours?: WeekHours;
  // When parking isn't allowed at all.
  noParkingHours?: WeekHours;
  zone?: string;
  perHour?: number;
}

export interface StreetParkingSource {
  around(point: { lat: number; lon: number }, radiusM?: number): Promise<StreetSpot[]>;
}

const RADIUS_M = 500;
const M_PER_DEG = 111_320;
const SPECIAL: Record<string, StreetSpot["type"]> = { Sähköauto: "ev", Inva: "accessible" };
const NOT_FOR_CARS = new Set(["Pysäköintikielto", "Pysäyttämiskielto", "Taxi", "Kuormauspaikka", "CD"]);
const FREE = new Set([1, 2, 8, 9]);
const PAID = new Set([3, 4, 5, 6, 7, 10]);
// The time limit the class itself sets, when the spot doesn't say.
const CLASS_STAY_MIN: Record<number, number> = { 3: 60, 4: 120, 5: 240, 7: 60 };
const DISC = 8;
// Parking allowed outside the no-parking hours, which `voimassaolo` gives.
const OUTSIDE_HOURS = 9;

type Polygonal = { type: string; coordinates: number[][][] | number[][][][] };
interface Area {
  geometry: Polygonal | null;
  properties: { luokka: number | null; tyyppi: string | null; kesto?: string | null; voimassaolo?: string | null; paikat_ala: number | null; paikat_des: number | null };
}
interface Zone {
  geometry: Polygonal | null;
  properties: { nimi: string; lisatiedot: string | null };
}

export function helsinkiStreetParking({ url, layer, zonesLayer, fetchFn = fetch }: StreetParkingOptions): StreetParkingSource {
  const features = async <T>(params: Record<string, string>): Promise<T[]> => {
    const query = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", outputFormat: "application/json", srsName: "EPSG:4326", ...params });
    const res = await fetchFn(`${url}?${query}`);
    if (!res.ok) throw new Error(`Street parking WFS responded ${res.status}`);
    return ((await res.json()) as { features: T[] }).features;
  };

  // Two zones that change rarely: asked once, again only after a failure.
  let zones: Promise<Zone[]> | undefined;
  const feeZones = () => {
    if (!zonesLayer) return Promise.resolve([]);
    zones ??= features<Zone>({ typeNames: zonesLayer }).catch(() => {
      zones = undefined;
      return [];
    });
    return zones;
  };

  return {
    async around({ lat, lon }, radiusM = RADIUS_M) {
      const dLat = radiusM / M_PER_DEG;
      const dLon = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
      const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon, "urn:ogc:def:crs:EPSG::4326"].join(",");
      const [areas, priced] = await Promise.all([features<Area>({ typeNames: layer, bbox }), feeZones()]);

      return areas.flatMap(({ geometry, properties: p }): StreetSpot[] => {
        if (!geometry) return [];
        const special = SPECIAL[p.tyyppi ?? ""];
        const classed = p.luokka && !NOT_FOR_CARS.has(p.tyyppi ?? "") ? p.luokka : undefined;
        const kind = special ? "other" : classed && FREE.has(classed) ? "free" : classed && PAID.has(classed) ? "paid" : undefined;
        if (!kind) return [];
        const spaces = p.paikat_ala ?? Math.round(p.paikat_des ?? 0);
        const centre = centreOf(geometry);
        const distance = Math.round(distanceM({ lat, lon }, centre));
        if (!spaces || distance > radiusM) return [];
        const hours = weekHours(p.voimassaolo);
        const maxStayMin = minutesOf(p.kesto) ?? (p.luokka ? CLASS_STAY_MIN[p.luokka] : undefined);
        const zone = kind === "paid" ? priced.find((z) => z.geometry && insidePolygonal(centre, z.geometry)) : undefined;
        const perHour = zone && pricePerHour(zone.properties.lisatiedot);
        return [
          {
            ...centre,
            distanceM: distance,
            spaces,
            kind,
            ...(special ? { type: special } : {}),
            ...(maxStayMin ? { maxStayMin } : {}),
            disc: p.luokka === DISC,
            ...(kind === "paid" && hours ? { paidHours: hours } : {}),
            ...(p.luokka === OUTSIDE_HOURS && hours ? { noParkingHours: hours } : {}),
            ...(zone ? { zone: zone.properties.nimi } : {}),
            ...(perHour ? { perHour } : {}),
          },
        ];
      });
    },
  };
}

// "4 h", "4h", "60 min" → minutes.
function minutesOf(text: string | null | undefined): number | undefined {
  const match = text?.trim().match(/^(\d+)\s*(h|min)$/);
  if (!match) return undefined;
  return Number(match[1]) * (match[2] === "h" ? 60 : 1);
}

// "9-21, (9-18), 10-16": weekdays, (Saturdays), Sundays — the way Helsinki's signs read.
function weekHours(text: string | null | undefined): WeekHours | undefined {
  const parts = (text ?? "").split(",").map((part) => part.trim().replace(/^\((.*)\)$/, "$1"));
  const [weekdays, sat, sun] = parts.map((part) => {
    const match = part.match(/^(\d{1,2})-(\d{1,2})$/);
    return match ? ([Number(match[1]) * 60, Number(match[2]) * 60] as [number, number]) : undefined;
  });
  if (!weekdays) return undefined;
  return { weekdays, ...(sat ? { sat } : {}), ...(sun ? { sun } : {}) };
}

// "…pysäköinti maksaa 4 euroa tunnilta…"
function pricePerHour(text: string | null): number | undefined {
  const match = text?.match(/(\d+(?:[.,]\d+)?)\s*euroa tunnilta/);
  return match ? Number(match[1]!.replace(",", ".")) : undefined;
}

function rings(geometry: Polygonal): number[][][] {
  return geometry.type === "MultiPolygon" ? (geometry.coordinates as number[][][][]).flat() : (geometry.coordinates as number[][][]);
}

function centreOf(geometry: Polygonal): { lat: number; lon: number } {
  const ring = rings(geometry)[0] ?? [];
  const lons = ring.map((c) => c[0] ?? 0);
  const lats = ring.map((c) => c[1] ?? 0);
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
}

function insidePolygonal({ lat, lon }: { lat: number; lon: number }, geometry: Polygonal): boolean {
  let within = false;
  for (const ring of rings(geometry)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi = 0, yi = 0] = ring[i]!;
      const [xj = 0, yj = 0] = ring[j]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) within = !within;
    }
  }
  return within;
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (((b.lon - a.lon) * Math.PI) / 180) * Math.cos((a.lat * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.hypot(x, y) * 6_371_000;
}
