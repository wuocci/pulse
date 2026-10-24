import type { EventKind, Region as PublicRegion } from "@pulse/schema";
import { fiCapitalRegion } from "./fi-capital-region.ts";

// A Region exists only as configuration (CONTEXT.md). Place names belong here, never in code or file names.

// What /v0/regions shows, plus the Sources, which stay internal.
export interface Region extends PublicRegion {
  sources: SourceConfig[];
}

// One entry per feed a Source publishes. `adapter` picks the code that reads its format (ADR 0002).
export interface SourceConfig {
  id: string;
  adapter: "land-use-permits";
  url: string;
  layer: string;
  kind: EventKind;
  publisher: string;
  license: string;
  refreshMinutes: number;
}

export const regions: Region[] = [fiCapitalRegion];
