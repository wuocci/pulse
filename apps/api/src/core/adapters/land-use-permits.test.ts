import { EventSchema } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import fixture from "./fixtures/land-use-permits.json" with { type: "json" };
import { localTime, type PermitCollection, permitsUrl, toEvents } from "./land-use-permits.ts";

// Recorded from the excavation notice layer on 2026-10-23.
const collection = fixture as PermitCollection;
const source = fiCapitalRegion.sources.find((s) => s.adapter === "land-use-permits")!;
const context = { source, timeZone: fiCapitalRegion.timeZone, now: new Date("2026-10-24T12:00:00+03:00") };

describe("land-use permit notices → Events", () => {
  const events = toEvents(collection, context);

  it("turns every notice into a valid Event", () => {
    expect(events).toHaveLength(4);
    for (const event of events) expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("maps a notice's fields, keeping the original text", () => {
    const event = events.find((e) => e.id === `${source.id}:KP2602791-2`)!;

    expect(event.kind).toBe(source.kind);
    expect(event.where.precision).toBe("area");
    expect(event.when).toEqual({ start: "2026-10-29T00:00:00+02:00", end: "2026-11-13T23:59:59+02:00" });
    expect(event.title).toEqual({
      en: "Excavation · Vilppulantie 26 · until 13 Nov",
      fi: "Kaivutyö · Vilppulantie 26 · 13.11. asti",
    });
    expect(event.originalText?.fi).toMatch(/^Sadevesiviemärin korjaus/);
    expect(event.sources[0]).toMatchObject({ name: source.publisher, id: "KP2602791-2", license: source.license });
  });

  it("leaves the address out of the title when the notice has none", () => {
    const [first] = collection.features;
    const [event] = toEvents({ features: [{ ...first!, properties: { ...first!.properties, osoite: null } }] }, context);

    expect(event!.title.en).toMatch(/^Excavation · until /);
  });

  it("derives status from the dates", () => {
    const status = Object.fromEntries(events.map((e) => [e.sources[0]!.id, e.status]));

    expect(status).toEqual({
      "KP2602791-2": "upcoming",
      KP2603015: "upcoming",
      KP2602966: "active",
      KP2603005: "active",
    });
  });

  it("merges the areas of one notice into a single Event", () => {
    const [first, second] = collection.features;
    const split: PermitCollection = {
      features: [first!, { ...second!, properties: { ...second!.properties, hakemustunnus: first!.properties.hakemustunnus } }],
    };
    const merged = toEvents(split, context);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.where.geometry.type).toBe("MultiPolygon");
    expect(merged[0]!.where.geometry.coordinates).toHaveLength(2);
  });

  it("keeps coordinates in GeoJSON order, longitude first", () => {
    const [lon, lat] = (events[0]!.where.geometry.coordinates as number[][][][])[0]![0]![0]!;

    expect(lon).toBeGreaterThan(24);
    expect(lat).toBeGreaterThan(60);
  });

  it("asks the WFS for the configured layer in WGS84", () => {
    const url = new URL(permitsUrl(source));

    expect(url.searchParams.get("typeName")).toBe(source.layer);
    expect(url.searchParams.get("srsName")).toBe("EPSG:4326");
  });
});

describe("localTime", () => {
  it("uses the zone's offset for that day, including summer time", () => {
    expect(localTime("2026-10-24", "00:00:00", "Europe/Helsinki")).toBe("2026-10-24T00:00:00+03:00");
    expect(localTime("2026-10-26", "00:00:00", "Europe/Helsinki")).toBe("2026-10-26T00:00:00+02:00");
    expect(localTime("2026-07-01", "12:00:00", "America/New_York")).toBe("2026-07-01T12:00:00-04:00");
  });
});
