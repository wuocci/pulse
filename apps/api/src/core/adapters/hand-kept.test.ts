import { EventSchema } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import type { HandKeptSource } from "../regions/index.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { toEvents } from "./hand-kept.ts";

const source: HandKeptSource = {
  id: "hand-kept",
  adapter: "hand-kept",
  publisher: "Pulse, from the publishers' pages",
  license: "CC BY 4.0",
  refreshMinutes: 60,
  entries: [
    {
      id: "bridge",
      kind: "works",
      title: { en: "Bridge closed" },
      where: { geometry: { type: "LineString", coordinates: [[24.99445, 60.18555], [24.9947, 60.186]] }, precision: "exact" },
      when: { start: "2026-02-02T00:00:00+02:00", end: "2026-11-30T23:59:59+02:00" },
      severity: "major",
      mainlyAffected: "everyone",
      noticeable: ["blocked"],
      originalText: { fi: "Silta on suljettu." },
      readFrom: "City of Helsinki news, 30 Oct 2026",
      checked: "2026-11-02",
    },
  ],
};

describe("a hand-kept Source", () => {
  it("gives each entry as a valid Event, credited to where it was read and when it was checked", () => {
    const [event] = toEvents(source, new Date("2026-11-02T08:00:00Z"));

    expect(EventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      id: "hand-kept:bridge",
      layers: ["area", "trips", "now"],
      severity: "major",
      mainlyAffected: "everyone",
      status: "active",
      sources: [{ name: "Pulse, from the publishers' pages", id: "bridge", attribution: "City of Helsinki news, 30 Oct 2026", updatedAt: "2026-11-02T00:00:00.000Z" }],
      confidence: 1,
    });
  });

  it("takes its status from the dates", () => {
    expect(toEvents(source, new Date("2026-01-15T12:00:00Z"))[0]!.status).toBe("upcoming");
    expect(toEvents(source, new Date("2026-12-15T12:00:00Z"))[0]!.status).toBe("resolved");
  });

  it("keeps the capital region's entries valid", () => {
    const handKept = fiCapitalRegion.sources.filter((s): s is HandKeptSource => s.adapter === "hand-kept");

    expect(handKept).toHaveLength(1);
    for (const event of toEvents(handKept[0]!, new Date("2026-11-02T08:00:00Z"))) expect(EventSchema.safeParse(event).success).toBe(true);
  });
});
