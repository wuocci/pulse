import type { DailyHours, Event, EventKind, MainlyAffected, Region as PublicRegion } from "@pulse/schema";
import { fiCapitalRegion } from "./fi-capital-region.ts";

// A Region exists only as configuration (CONTEXT.md). Place names belong here, never in code or file names.

// What /v0/regions shows, plus the Sources, which stay internal.
export interface Region extends PublicRegion {
  sources: SourceConfig[];
  // Local working hours per Event kind, for the Right now Layer when a Source gives none. Kinds left out count all day.
  defaultDailyHours: Partial<Record<EventKind, DailyHours>>;
  // Where address search looks; without it, the Region has none.
  geocoder?: { kind: "digitransit"; url: string };
  // Where Trips are planned; without it, the Region has no Trips.
  router?: { kind: "digitransit"; url: string };
  // Street parking around a Trip's destination (car parks come from the router). Credited by publisher and licence.
  streetParking?: { kind: "helsinki-wfs"; url: string; layer: string; zonesLayer?: string; publisher: string; license: string };
}

// One entry per feed a Source publishes. `adapter` picks the code that reads its format (ADR 0002).
export type SourceConfig = LandUsePermitSource | GtfsRtSource | DigitrafficSource | CapSource | HandKeptSource;

interface BaseSource {
  id: string;
  url: string;
  publisher: string;
  license: string;
  refreshMinutes: number;
  // For feeds that drop what's over: a vanished Event stays this long as resolved. Without it, it just goes.
  keepVanishedHours?: number;
}

export interface LandUsePermitSource extends BaseSource {
  adapter: "land-use-permits";
  layer: string;
  // Each layer of the permit system has its own fields.
  permitType: "excavation" | "traffic-arrangement" | "outdoor-event";
  // Month-days (MM-DD) the system's rules put in an end date field instead of the work's own end.
  ruleEndDays?: string[];
}

// Fintraffic's road traffic messages: a national feed, kept to the Region's bbox.
export interface DigitrafficSource extends BaseSource {
  adapter: "digitraffic";
}

// Long-running disruptions no feed carries (a bridge repair, a metro outage), kept by hand from the publishers' own
// pages. Each entry says where it was read and when it was last checked: it goes stale unless someone keeps it.
export interface CapSource extends BaseSource {
  adapter: "cap";
  attribution?: string;
  // Mainly affected per CAP eventCode value; codes not listed affect everyone.
  mainlyAffected?: Record<string, MainlyAffected>;
}

export interface HandKeptSource extends Omit<BaseSource, "url"> {
  adapter: "hand-kept";
  entries: HandKeptEntry[];
}

export interface HandKeptEntry extends Pick<Event, "kind" | "title" | "where" | "when" | "severity" | "mainlyAffected" | "noticeable"> {
  id: string;
  // What it closes, for whom, in the publisher's terms.
  originalText: Record<string, string>;
  // Where it was read, and the day it was last checked there (YYYY-MM-DD).
  readFrom: string;
  checked: string;
}

export const isPermitSource = (source: SourceConfig): source is LandUsePermitSource => source.adapter === "land-use-permits";

// A GTFS-RT service alerts feed.
export interface GtfsRtSource extends BaseSource {
  adapter: "gtfs-rt";
  // Prefixes the feed's own stop and route ids into the ids its stop directory knows ("HSL" + "1234" → "HSL:1234").
  feedId: string;
  // Where stop locations and route names come from: the feed only gives ids.
  directory: { kind: "digitransit"; url: string };
}

export const regions: Region[] = [fiCapitalRegion];

// The Region whose bounding box holds the point.
export function regionAt(regions: Region[], lat: number, lon: number): Region | undefined {
  return regions.find(
    ({ bbox: [minLon, minLat, maxLon, maxLat] }) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat,
  );
}
