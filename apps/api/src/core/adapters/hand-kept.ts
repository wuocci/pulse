import type { Event } from "@pulse/schema";
import type { HandKeptSource } from "../regions/index.ts";
import { statusAt } from "./land-use-permits.ts";

// A hand-kept Source's entries as Events: status from their dates, credited to where each was read.
export function toEvents(source: HandKeptSource, now: Date): Event[] {
  return source.entries.map(({ id, readFrom, checked, originalText, ...entry }) => {
    const checkedAt = new Date(`${checked}T00:00:00Z`).toISOString();
    return {
      ...entry,
      id: `${source.id}:${id}`,
      layers: ["area", "trips", "now"],
      originalText,
      status: statusAt(now, entry.when.start, entry.when.end),
      sources: [{ name: source.publisher, id, updatedAt: checkedAt, license: source.license, attribution: readFrom }],
      // Read by a person from the publisher's own page.
      confidence: 1,
      updatedAt: checkedAt,
    };
  });
}
