import type { DailyHours, Event, Geometry, MainlyAffected, Severity, Weekday } from "@pulse/schema";
import type { DigitrafficSource, Region } from "../regions/index.ts";
import { statusAt } from "./land-use-permits.ts";

// Digitraffic Adapter (ADR 0002): Fintraffic's road traffic messages (simple JSON API), national, kept per Region.
// Roadworks and traffic notices on the roads Fintraffic runs (Kehä I/III, the motorways…), which the city's permits
// don't cover. The structure is in the feed (restrictions, hours, road sections), so no Classifier (ADR 0003).
// Weight restrictions aren't asked for: they concern heavy vehicles, not people's trips.

// Digitraffic asks every client to say who it is; no personal details.
const USER = "pulse";
const SITUATION_TYPES = ["ROAD_WORK", "TRAFFIC_ANNOUNCEMENT"] as const;

interface RoadPoint {
  roadName?: string;
  alertCLocation?: { name?: string };
}
interface Location {
  description?: string;
}
interface LocationDetails {
  roadAddressLocation?: { primaryPoint?: RoadPoint };
}
interface Phase {
  locationDetails?: LocationDetails;
  workingHours?: { weekday: string; startTime: string; endTime: string }[];
  restrictions?: { type: string }[];
}
interface Announcement {
  title?: string;
  location?: Location;
  locationDetails?: LocationDetails;
  features?: { name: string }[];
  roadWorkPhases?: Phase[];
  timeAndDuration?: { startTime?: string; endTime?: string };
}
export interface MessageCollection {
  features: {
    geometry: { type: string; coordinates: unknown } | null;
    properties: { situationId: string; situationType: string; announcements: Announcement[] };
  }[];
}

export interface MessageContext {
  source: DigitrafficSource;
  region: Region;
  now: Date;
}

export async function fetchMessages(source: DigitrafficSource, fetchFn: typeof fetch = fetch): Promise<MessageCollection> {
  const url = new URL(source.url);
  url.searchParams.set("inactiveHours", "0");
  url.searchParams.set("includeAreaGeometry", "false");
  for (const type of SITUATION_TYPES) url.searchParams.append("situationType", type);
  const res = await fetchFn(url, { headers: { "Digitraffic-User": USER } });
  if (!res.ok) throw new Error(`${source.id}: Digitraffic responded ${res.status}`);
  return (await res.json()) as MessageCollection;
}

// What a restriction closes, worst first: the road (or a detour around it), or lanes.
const CLOSES_ROAD = new Set(["ROAD_CLOSED", "DETOUR", "SINGLE_CARRIAGEWAY_CLOSED"]);
const CLOSES_LANES = new Set(["SINGLE_LANE_CLOSED", "MULTIPLE_LANES_CLOSED", "SINGLE_ALTERNATE_LINE_TRAFFIC", "INTERMITTENT_STOPS_AND_CLOSURE_EFFECTIVE"]);
const CLOSES_PATH = "NARROW_OR_CLOSED_PEDESTRIAN_AND_BICYLE_PATH";

const LABELS = { ROAD_WORK: { en: "Roadworks", fi: "Tietyö" }, TRAFFIC_ANNOUNCEMENT: { en: "Traffic notice", fi: "Liikennetiedote" } } as const;

export function toEvents(collection: MessageCollection, { source, region, now }: MessageContext): Event[] {
  return collection.features.flatMap(({ geometry, properties }) => {
    const type = properties.situationType;
    const announcement = properties.announcements[0];
    if (!geometry || !announcement || (type !== "ROAD_WORK" && type !== "TRAFFIC_ANNOUNCEMENT")) return [];
    if (!inBbox(geometry.coordinates, region.bbox)) return [];
    const start = announcement.timeAndDuration?.startTime;
    if (!start) return [];
    const end = announcement.timeAndDuration?.endTime;
    const phases = announcement.roadWorkPhases ?? [];
    const restrictions = new Set(phases.flatMap((p) => (p.restrictions ?? []).map((r) => r.type)));
    // Traffic notices have no typed restrictions; their features say whether the road is closed.
    const roadClosed =
      [...restrictions].some((r) => CLOSES_ROAD.has(r)) ||
      (type === "TRAFFIC_ANNOUNCEMENT" && (announcement.features ?? []).some((f) => /^tie on suljettu/i.test(f.name)));
    const lanesClosed = [...restrictions].some((r) => CLOSES_LANES.has(r));
    const pathClosed = restrictions.has(CLOSES_PATH);
    const severity: Severity = roadClosed ? "major" : lanesClosed || pathClosed || type === "TRAFFIC_ANNOUNCEMENT" ? "consider" : "minor";
    const mainlyAffected: MainlyAffected = pathClosed ? "everyone" : "drivers";
    const dailyHours = hoursOf(phases);
    const place = placeOf(phases[0]?.locationDetails ?? announcement.locationDetails);
    const label = LABELS[type];
    const originalText = [announcement.title, announcement.location?.description].map((t) => t?.trim()).filter(Boolean).join("\n");

    return [
      {
        id: `${source.id}:${properties.situationId}`,
        kind: type === "ROAD_WORK" ? "works" : "disruption",
        layers: type === "ROAD_WORK" ? ["area", "trips"] : ["area", "trips", "now"],
        title: { en: [label.en, ...place].join(" · "), fi: [label.fi, ...place].join(" · ") },
        ...(originalText ? { originalText: { fi: originalText } } : {}),
        where: { geometry: geometry as Geometry, precision: geometry.type === "Point" ? "exact" : "segment" },
        when: { start, ...(end ? { end } : {}), ...(dailyHours ? { dailyHours } : {}) },
        severity,
        mainlyAffected,
        noticeable: roadClosed || lanesClosed || pathClosed ? ["blocked"] : [],
        status: statusAt(now, start, end),
        sources: [{ name: source.publisher, id: properties.situationId, updatedAt: now.toISOString(), license: source.license }],
        // The feed's own structure, not a Classifier's guess.
        confidence: 1,
        updatedAt: now.toISOString(),
      } satisfies Event,
    ];
  });
}

// "Kehä I · Pukinmäen liittymä": the road, then the place on it; whichever the message has.
function placeOf(details: LocationDetails | undefined): string[] {
  const point = details?.roadAddressLocation?.primaryPoint;
  return [point?.roadName, point?.alertCLocation?.name].flatMap((name) => (name?.trim() ? [name.trim()] : []));
}

const WEEKDAYS: Record<string, Weekday> = { MONDAY: "mon", TUESDAY: "tue", WEDNESDAY: "wed", THURSDAY: "thu", FRIDAY: "fri", SATURDAY: "sat", SUNDAY: "sun" };
const ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// The work's hours, when every listed day has the same ones (the Event holds one set). Otherwise none: all day.
function hoursOf(phases: Phase[]): DailyHours | undefined {
  const entries = phases.flatMap((p) => p.workingHours ?? []);
  const first = entries[0];
  if (!first || entries.some((e) => e.startTime !== first.startTime || e.endTime !== first.endTime)) return undefined;
  const days = ORDER.filter((day) => entries.some((e) => WEEKDAYS[e.weekday] === day));
  return { from: first.startTime.slice(0, 5), to: first.endTime.slice(0, 5), ...(days.length < 7 ? { days } : {}) };
}

// Whether any of the geometry's points lies in the Region.
function inBbox(coordinates: unknown, [minLon, minLat, maxLon, maxLat]: Region["bbox"]): boolean {
  if (!Array.isArray(coordinates)) return false;
  if (typeof coordinates[0] === "number") {
    const [lon, lat] = coordinates as number[];
    return lon! >= minLon && lon! <= maxLon && lat! >= minLat && lat! <= maxLat;
  }
  return coordinates.some((c) => inBbox(c, [minLon, minLat, maxLon, maxLat]));
}
