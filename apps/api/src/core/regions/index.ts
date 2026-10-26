import type { Region as PublicRegion } from "@pulse/schema";
import { fiCapitalRegion } from "./fi-capital-region.ts";

// A Region exists only as configuration (CONTEXT.md). Place names belong here, never in code or file names.

// What /v0/regions shows, plus the Sources, which stay internal.
export interface Region extends PublicRegion {
  sources: SourceConfig[];
  // Realtime streams recorded as Conditions rather than Events.
  conditionSources?: ConditionSourceConfig[];
}

// One entry per feed a Source publishes. `adapter` picks the code that reads its format (ADR 0002).
export type SourceConfig = LandUsePermitSource;

interface BaseSource {
  id: string;
  url: string;
  publisher: string;
  license: string;
}

// A Source fetched on an interval.
interface PolledSource extends BaseSource {
  refreshMinutes: number;
}

export interface LandUsePermitSource extends PolledSource {
  adapter: "land-use-permits";
  layer: string;
  // Each layer of the permit system has its own fields.
  permitType: "excavation" | "traffic-arrangement" | "outdoor-event";
}

// A realtime stream of transit vehicle positions in HSL's HFP format over MQTT, recorded as 5-minute delay Conditions.
export interface HfpSource extends BaseSource {
  adapter: "hfp";
  // MQTT topic filter to subscribe to
  topic: string;
}

export type ConditionSourceConfig = HfpSource;

export const regions: Region[] = [fiCapitalRegion];
