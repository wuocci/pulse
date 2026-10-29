import type { DailyHours, EventKind, Region as PublicRegion } from "@pulse/schema";
import { fiCapitalRegion } from "./fi-capital-region.ts";

// A Region exists only as configuration (CONTEXT.md). Place names belong here, never in code or file names.

// What /v0/regions shows, plus the Sources, which stay internal.
export interface Region extends PublicRegion {
  sources: SourceConfig[];
  // Local working hours per Event kind, for the Right now Layer when a Source gives none. Kinds left out count all day.
  defaultDailyHours: Partial<Record<EventKind, DailyHours>>;
}

// One entry per feed a Source publishes. `adapter` picks the code that reads its format (ADR 0002).
export type SourceConfig = LandUsePermitSource | GtfsRtSource;

interface BaseSource {
  id: string;
  url: string;
  publisher: string;
  license: string;
  refreshMinutes: number;
}

export interface LandUsePermitSource extends BaseSource {
  adapter: "land-use-permits";
  layer: string;
  // Each layer of the permit system has its own fields.
  permitType: "excavation" | "traffic-arrangement" | "outdoor-event";
  // Month-days (MM-DD) the system's rules put in an end date field instead of the work's own end.
  ruleEndDays?: string[];
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
