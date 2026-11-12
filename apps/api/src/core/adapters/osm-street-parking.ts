// Street parking from OpenStreetMap (the Overpass API), for streets the city's own data leaves out. OSM tags parking
// per street section and side (`parking:left`, `parking:both`… and the older `parking:lane:*`), with its rules under
// `parking:condition:*` or `parking:<side>:*`. Each section is cut into short pieces, so a long street gives a spot
// near where you'd stop; its spaces are worked out from the piece's length, less driveways and gaps, so they're an
// estimate.
//
// Overpass is asked per map tile and the answer is kept for a week: street parking rules change rarely, and its
// usage policy doesn't allow a request for every Trip.

import { distanceM, type StreetParkingSource, type StreetSpot, type WeekHours } from "./street-parking.ts";

export interface OsmStreetParkingOptions {
  // The Overpass API's interpreter endpoint.
  url: string;
  // How the spots are credited, e.g. "© OpenStreetMap contributors (ODbL)".
  credit: string;
  fetchFn?: typeof fetch;
  // How long a tile's answer is kept.
  keepMs?: number;
  now?: () => number;
}

interface Way {
  type: "way";
  id: number;
  tags: Record<string, string>;
  geometry: { lat: number; lon: number }[];
}

type Side = "left" | "right";
type Orientation = "parallel" | "diagonal" | "perpendicular";
// What one side of a street offers.
interface Rule {
  orientation: Orientation;
  kind: "free" | "paid";
  disc: boolean;
  maxStayMin?: number;
  paidHours?: WeekHours;
}

const RADIUS_M = 500;
const WEEK_MS = 7 * 86_400_000;
// A tile is about 1.1 km by 1.1 km in Helsinki.
const TILE_LAT = 0.01;
const TILE_LON = 0.02;
const M_PER_DEG = 111_320;
// Long sections are cut into pieces at most this long.
const PIECE_M = 100;
// How much of a street's kerb is left for cars: driveways, crossings and gaps take the rest.
const KERB_USED = 0.7;
// The kerb one car takes, by how cars stand.
const CAR_M: Record<Orientation, number> = { parallel: 5.5, diagonal: 3, perpendicular: 2.5 };
const PARKS = new Set(["lane", "yes", "street_side", "on_kerb", "half_on_kerb", "shoulder"]);
const OLD_LANE = new Set(["parallel", "diagonal", "perpendicular", "marked", "yes"]);
// Not for anyone arriving: residents' or customers' parking, or no parking at all.
const NOT_FOR_ALL = new Set(["residents", "private", "customers", "no_parking", "no_stopping", "no", "loading", "disabled"]);

export function osmStreetParking({ url, credit, fetchFn = fetch, keepMs = WEEK_MS, now = Date.now }: OsmStreetParkingOptions): StreetParkingSource {
  const tiles = new Map<string, { at: number; ways: Promise<Way[]> }>();

  const tile = (row: number, col: number): Promise<Way[]> => {
    const key = `${row}:${col}`;
    const kept = tiles.get(key);
    if (kept && now() - kept.at < keepMs) return kept.ways;
    const [s, w] = [row * TILE_LAT, col * TILE_LON];
    const bbox = [s, w, s + TILE_LAT, w + TILE_LON].map((n) => n.toFixed(4)).join(",");
    const query = `[out:json][timeout:25];way["highway"][~"^parking:(both|left|right|lane:both|lane:left|lane:right)$"~"."](${bbox});out tags geom;`;
    const ways = fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "pulse (github.com/wuocci/pulse)" },
      body: new URLSearchParams({ data: query }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
        return ((await res.json()) as { elements: Way[] }).elements.filter((e) => e.type === "way" && e.geometry?.length > 1);
      })
      .catch((error: unknown) => {
        // Asked again next time instead of keeping the failure for a week.
        tiles.delete(key);
        throw error;
      });
    tiles.set(key, { at: now(), ways });
    return ways;
  };

  return {
    async around(point, radiusM = RADIUS_M) {
      const dLat = radiusM / M_PER_DEG;
      const dLon = radiusM / (M_PER_DEG * Math.cos((point.lat * Math.PI) / 180));
      const rows = range(Math.floor((point.lat - dLat) / TILE_LAT), Math.floor((point.lat + dLat) / TILE_LAT));
      const cols = range(Math.floor((point.lon - dLon) / TILE_LON), Math.floor((point.lon + dLon) / TILE_LON));
      const answers = await Promise.all(rows.flatMap((row) => cols.map((col) => tile(row, col))));
      // A way across a tile edge comes in both tiles' answers.
      const ways = new Map(answers.flat().map((way) => [way.id, way]));

      return [...ways.values()].flatMap((way) => {
        const rules = (["left", "right"] as const).map((side) => ruleOf(way.tags, side)).filter((r): r is Rule => r !== undefined);
        if (!rules.length) return [];
        return piecesOf(way.geometry).flatMap(({ middle, lengthM }): StreetSpot[] => {
          const distance = Math.round(distanceM(point, middle));
          if (distance > radiusM) return [];
          // Both sides alike: one spot with both sides' spaces.
          const alike = new Map<string, { rule: Rule; spaces: number }>();
          for (const rule of rules) {
            const key = JSON.stringify(rule);
            const spaces = Math.floor((lengthM * KERB_USED) / CAR_M[rule.orientation]);
            alike.set(key, { rule, spaces: (alike.get(key)?.spaces ?? 0) + spaces });
          }
          return [...alike.values()]
            .filter(({ spaces }) => spaces > 0)
            .map(({ rule, spaces }) => ({
              ...middle,
              distanceM: distance,
              spaces,
              estimated: true,
              kind: rule.kind,
              disc: rule.disc,
              ...(rule.maxStayMin ? { maxStayMin: rule.maxStayMin } : {}),
              ...(rule.paidHours ? { paidHours: rule.paidHours } : {}),
              credit,
            }));
        });
      });
    },
  };
}

// One side's parking, if anyone arriving may park there.
export function ruleOf(tags: Record<string, string>, side: Side): Rule | undefined {
  const lane = (rest = "") => tags[`parking:${side}${rest}`] ?? tags[`parking:both${rest}`];
  const condition = (rest = "") => tags[`parking:condition:${side}${rest}`] ?? tags[`parking:condition:both${rest}`];

  const now = lane();
  const old = tags[`parking:lane:${side}`] ?? tags["parking:lane:both"];
  const parks = now !== undefined ? PARKS.has(now) : old !== undefined && OLD_LANE.has(old);
  if (!parks) return undefined;
  const orientation = asOrientation(lane(":orientation") ?? old);

  const rules = condition();
  const access = lane(":access");
  if ((rules && NOT_FOR_ALL.has(rules)) || (access && NOT_FOR_ALL.has(access)) || access === "permit") return undefined;
  const restriction = lane(":restriction");
  if (restriction && NOT_FOR_ALL.has(restriction) && !lane(":restriction:conditional")) return undefined;

  const paid = rules === "ticket" || lane(":fee") === "yes";
  const disc = rules === "disc" || lane(":authentication:disc") === "yes";
  const maxStayMin = minutesOf(condition(":maxstay") ?? lane(":maxstay") ?? lane(":maxstay:conditional")?.split("@")[0]);
  const paidHours = paid ? weekHours(condition(":time_interval") ?? lane(":fee:conditional")?.match(/yes\s*@\s*\((.*)\)/)?.[1]) : undefined;
  return {
    orientation,
    kind: paid ? "paid" : "free",
    disc,
    ...(maxStayMin ? { maxStayMin } : {}),
    ...(paidHours ? { paidHours } : {}),
  };
}

function asOrientation(value: string | undefined): Orientation {
  return value === "diagonal" || value === "perpendicular" ? value : "parallel";
}

// "10 h", "2h", "90 min", "1:30" → minutes.
function minutesOf(text: string | undefined): number | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  const clock = value.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(h|hours?|min|minutes?)$/);
  if (!match) return undefined;
  return Math.round(Number(match[1]) * (match[2]!.startsWith("h") ? 60 : 1));
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// The common opening-hours forms: "Mo-Fr 08:00-18:00; Sa 09:00-15:00". Anything else isn't read.
export function weekHours(text: string | undefined): WeekHours | undefined {
  const hours: WeekHours = {};
  for (const part of (text ?? "").split(";").map((p) => p.trim()).filter(Boolean)) {
    const match = part.match(/^([A-Z][a-z](?:-[A-Z][a-z])?(?:,[A-Z][a-z](?:-[A-Z][a-z])?)*)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (!match) return undefined;
    const days = new Set(
      match[1]!.split(",").flatMap((span) => {
        const [from, to = from] = span.split("-");
        const [a, b] = [DAYS.indexOf(from!), DAYS.indexOf(to!)];
        return a < 0 || b < a ? [] : DAYS.slice(a, b + 1);
      }),
    );
    const span: [number, number] = [Number(match[2]) * 60 + Number(match[3]), Number(match[4]) * 60 + Number(match[5])];
    if (DAYS.slice(0, 5).every((d) => days.has(d))) hours.weekdays = span;
    if (days.has("Sa")) hours.sat = span;
    if (days.has("Su")) hours.sun = span;
  }
  return hours.weekdays || hours.sat || hours.sun ? hours : undefined;
}

// A street cut into pieces of at most PIECE_M: each one's middle and length.
function piecesOf(line: { lat: number; lon: number }[]): { middle: { lat: number; lon: number }; lengthM: number }[] {
  const steps = line.slice(1).map((to, i) => ({ from: line[i]!, to, m: distanceM(line[i]!, to) }));
  const total = steps.reduce((sum, s) => sum + s.m, 0);
  const count = Math.max(1, Math.ceil(total / PIECE_M));
  const lengthM = total / count;
  return range(0, count - 1).map((i) => ({ middle: along(steps, lengthM * (i + 0.5)), lengthM }));
}

function along(steps: { from: { lat: number; lon: number }; to: { lat: number; lon: number }; m: number }[], at: number) {
  let left = at;
  for (const { from, to, m } of steps) {
    if (left <= m && m > 0) {
      const f = left / m;
      return { lat: round(from.lat + (to.lat - from.lat) * f), lon: round(from.lon + (to.lon - from.lon) * f) };
    }
    left -= m;
  }
  const last = steps.at(-1)!.to;
  return { lat: last.lat, lon: last.lon };
}

const round = (n: number) => Math.round(n * 1e7) / 1e7;
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
