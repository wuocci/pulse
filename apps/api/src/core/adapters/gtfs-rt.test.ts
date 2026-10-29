import { readFileSync } from "node:fs";
import { EventSchema } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import type { GtfsRtSource } from "../regions/index.ts";
import directoryFixture from "./fixtures/gtfs-rt/hsl-directory.json" with { type: "json" };
import { decodeAlerts, idsToLook, type StopDirectory, toEvents } from "./gtfs-rt.ts";

// Recorded 2026-10-29 08:17 local time from the live feed, with Digitransit's answers for its ids.
const feed = readFileSync(new URL("./fixtures/gtfs-rt/hsl-service-alerts.pb", import.meta.url));
const source = fiCapitalRegion.sources.find((s): s is GtfsRtSource => s.adapter === "gtfs-rt")!;
const now = new Date("2026-10-29T08:30:00+02:00");

const directory: StopDirectory = {
  async lookup({ stops, routes }) {
    return {
      stops: new Map(directoryFixture.stops.filter((s) => stops.includes(s.gtfsId)).map((s) => [s.gtfsId, s])),
      routes: new Map(directoryFixture.routes.filter((r) => routes.includes(r.gtfsId)).map((r) => [r.gtfsId, r])),
    };
  },
};

const eventsFor = async (src: GtfsRtSource = source, dir: StopDirectory = directory) => {
  const alerts = decodeAlerts(feed);
  return toEvents(alerts, await dir.lookup(idsToLook(alerts, src)), { source: src, region: fiCapitalRegion, now });
};
const byAlert = async (alertId: string) => (await eventsFor()).find((e) => e.id === `hsl-service-alerts:${alertId}`)!;

describe("GTFS-RT service alerts", () => {
  it("turns every alert into a valid disruption Event for transit", async () => {
    const events = await eventsFor();

    expect(events).toHaveLength(25);
    for (const event of events) {
      expect(EventSchema.safeParse(event).success, event.id).toBe(true);
      expect(event).toMatchObject({ kind: "disruption", mainlyAffected: "transit" });
    }
  });

  it("keeps the alert's own texts in every language, and its link", async () => {
    const event = await byAlert("322736");

    expect(event.title).toMatchObject({ fi: expect.stringMatching(/^Lähibussi 805 on poikkeusreitillä Puotilassa/) });
    expect(Object.keys(event.title).sort()).toEqual(["en", "fi", "sv"]);
    expect(Object.keys(event.originalText!).sort()).toEqual(["en", "fi", "sv"]);
    expect(event.sources[0]).toMatchObject({ name: "HSL", id: "322736", license: "CC BY 4.0", url: expect.stringMatching(/^https:\/\/www\.hsl\.fi\//) });
  });

  it("fills in lines and stops as the stop directory's ids, and places the Event at its stops", async () => {
    const event = await byAlert("322736");

    expect(event.where).toMatchObject({
      precision: "exact",
      lines: ["HSL:1805"],
      stops: ["HSL:1452141", "HSL:1452114", "HSL:1452109", "HSL:1452111", "HSL:1452139"],
      geometry: { type: "MultiPoint" },
    });
    expect(event.where.geometry.coordinates).toHaveLength(5);
  });

  it("lists a line even when the directory doesn't know it", async () => {
    expect((await byAlert("329298")).where.lines).toContain("HSL:1022K");
  });

  it("takes the time window from the active period", async () => {
    // 2026-10-01 16:16 – 2026-10-30 18:00 local time
    expect((await byAlert("322736")).when).toEqual({ start: "2026-10-01T13:16:00.000Z", end: "2026-10-30T16:00:00.000Z" });
    expect((await byAlert("322736")).status).toBe("active");
  });

  it("maps the alert's severity level", async () => {
    expect((await byAlert("322736")).severity).toBe("consider"); // WARNING
    expect((await byAlert("318405")).severity).toBe("info"); // INFO
  });

  describe("Right now", () => {
    it("gives a detour that lists stops the now Layer and outage", async () => {
      expect(await byAlert("322736")).toMatchObject({ layers: ["trips", "now"], noticeable: ["outage"] });
    });

    it("leaves other effects out of Right now, even with stops", async () => {
      expect(await byAlert("318405")).toMatchObject({ layers: ["trips"], noticeable: [] }); // OTHER_EFFECT
      expect(await byAlert("326003")).toMatchObject({ layers: ["trips"], noticeable: [] }); // NO_EFFECT
    });

    it("leaves a detour without stops out, and places it vaguely in the Region", async () => {
      const event = await byAlert("322884");
      const [minLon, minLat, maxLon, maxLat] = fiCapitalRegion.bbox;

      expect(event).toMatchObject({ layers: ["trips"], noticeable: [], where: { precision: "vague" } });
      expect(event.where.geometry).toEqual({
        type: "Polygon",
        coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
      });
    });

    it("isn't exact, nor now, when the directory knows none of its stops", async () => {
      const empty: StopDirectory = { lookup: async () => ({ stops: new Map(), routes: new Map() }) };
      const event = (await eventsFor(source, empty)).find((e) => e.id === "hsl-service-alerts:322736")!;

      expect(event).toMatchObject({ layers: ["trips"], noticeable: [], where: { precision: "vague", stops: expect.any(Array) } });
    });
  });

  it("has nothing HSL-specific: ids, publisher and license come from the Source config", async () => {
    const other: GtfsRtSource = { ...source, id: "other-alerts", feedId: "OTHER", publisher: "Other Transit", license: "ODbL" };
    const event = (await eventsFor(other)).find((e) => e.id === "other-alerts:322736")!;

    expect(event.where.stops).toContain("OTHER:1452141");
    expect(event.sources[0]).toMatchObject({ name: "Other Transit", license: "ODbL" });
  });
});
