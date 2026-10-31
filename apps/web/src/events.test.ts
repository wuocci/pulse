import type { Event } from "@pulse/client";
import { describe, expect, it } from "vitest";
import { nearestFirst, pinsFor, statusOf, textIn, toneOf, whenOf } from "./events.ts";

const base: Event = {
  id: "src:1",
  kind: "works",
  layers: ["area"],
  title: { fi: "Kaivutyö · Hämeentie 12", en: "Excavation · Hämeentie 12" },
  where: { geometry: { type: "Point", coordinates: [24.95, 60.18] }, precision: "area" },
  when: { start: "2026-10-01T00:00:00+03:00" },
  severity: "minor",
  mainlyAffected: "drivers",
  noticeable: ["noise"],
  status: "active",
  sources: [{ name: "City", id: "1", updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0,
  updatedAt: "2026-10-01T00:00:00+03:00",
};
const event = (patch: Partial<Event>): Event => ({ ...base, ...patch });
const here = { lat: 60.17, lon: 24.95 };

describe("where an Event's pins go", () => {
  it("puts a point's pin on it", () => {
    expect(pinsFor(base)).toEqual([[24.95, 60.18]]);
  });

  it("gives every transit stop its own pin", () => {
    const stops = event({ where: { geometry: { type: "MultiPoint", coordinates: [[24.9, 60.1], [24.91, 60.11]] }, precision: "exact" } });

    expect(pinsFor(stops)).toEqual([[24.9, 60.1], [24.91, 60.11]]);
  });

  it("puts an area's pin in the middle of its largest part", () => {
    const area = event({
      where: {
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [[[24.0, 60.0], [24.001, 60.0], [24.001, 60.001], [24.0, 60.0]]],
            [[[25.0, 61.0], [25.2, 61.0], [25.2, 61.2], [25.0, 61.2], [25.0, 61.0]]],
          ],
        },
        precision: "area",
      },
    });

    expect(pinsFor(area)).toEqual([[25.1, 61.1]]);
  });

  it("gives a vague Event no pin: it isn't drawn as if it were there", () => {
    expect(pinsFor(event({ where: { ...base.where, precision: "vague" } }))).toEqual([]);
  });
});

describe("how much an Event matters, as a colour", () => {
  it("keeps info and minor quiet, and marks consider and major", () => {
    expect(["info", "minor", "consider", "major"].map((severity) => toneOf(event({ severity: severity as Event["severity"] })))).toEqual([
      "quiet",
      "quiet",
      "consider",
      "major",
    ]);
  });
});

describe("the status line", () => {
  it("says all clear when nothing is going on", () => {
    expect(statusOf([], "now")).toEqual({ key: "statusClearNow" });
    expect(statusOf([], "14d")).toEqual({ key: "statusClearSoon" });
  });

  it("counts what's on the map, leaving out resolved Events, and names the major ones", () => {
    const events = [base, event({ id: "2", severity: "major" }), event({ id: "3", status: "resolved" })];

    expect(statusOf(events, "now")).toEqual({ key: "statusNow", count: 2, major: 1 });
    expect(statusOf(events, "14d")).toEqual({ key: "statusSoon", count: 2, major: 1 });
  });

  it("doesn't count region-wide notices: they have their own chip", () => {
    expect(statusOf([event({ where: { ...base.where, precision: "vague" } })], "now")).toEqual({ key: "statusClearNow" });
  });
});

describe("the order of pins", () => {
  it("is nearest first, so keyboard and screen-reader users meet the closest Event first", () => {
    const far = event({ id: "far", where: { ...base.where, geometry: { type: "Point", coordinates: [24.95, 60.2] } } });
    const near = event({ id: "near", where: { ...base.where, geometry: { type: "Point", coordinates: [24.95, 60.171] } } });

    expect(nearestFirst([far, near], here).map((p) => p.event.id)).toEqual(["near", "far"]);
  });
});

describe("an Event's text", () => {
  it("is in the first of the reader's languages the Event has", () => {
    expect(textIn(base.title, ["sv", "en", "fi"])).toBe("Excavation · Hämeentie 12");
  });

  it("falls back to any language it has", () => {
    expect(textIn({ sv: "Grävarbete" }, ["en", "fi"])).toBe("Grävarbete");
  });
});

describe("when an Event is, in plain words", () => {
  const timeZone = "Europe/Helsinki";
  const now = new Date("2026-10-30T12:00:00+02:00");
  const when = (w: Event["when"], status: Event["status"] = "active") => whenOf(event({ when: w, status }), timeZone, now);

  it("says until when something going on lasts", () => {
    expect(when({ start: "2026-10-01T07:00:00+03:00", end: "2026-11-13T23:59:59+02:00" })).toEqual({ key: "whenUntil", end: "Fri 13 Nov" });
  });

  it("says it's ongoing when it has no end", () => {
    expect(when({ start: "2026-10-01T07:00:00+03:00" })).toEqual({ key: "whenOngoing" });
  });

  it("gives the dates of something coming up", () => {
    expect(when({ start: "2026-11-02T07:00:00+02:00", end: "2026-11-06T16:00:00+02:00" }, "upcoming")).toEqual({
      key: "whenFromTo",
      start: "Mon 2 Nov",
      end: "Fri 6 Nov",
    });
    expect(when({ start: "2026-11-02T07:00:00+02:00" }, "upcoming")).toEqual({ key: "whenFrom", start: "Mon 2 Nov" });
  });

  it("says when something ended", () => {
    expect(when({ start: "2026-10-01T07:00:00+03:00", end: "2026-10-29T16:00:00+02:00" }, "resolved")).toEqual({ key: "whenEnded", end: "Thu 29 Oct" });
  });

  it("reads dates in the Region's time zone, not the device's", () => {
    // 23:30 UTC on the 12th is already the 13th in Helsinki.
    expect(when({ start: "2026-10-01T07:00:00Z", end: "2026-11-12T23:30:00Z" })).toEqual({ key: "whenUntil", end: "Fri 13 Nov" });
  });

  it("adds the daily hours: weekdays, every day, or the days named", () => {
    const start = "2026-10-01T07:00:00+03:00";
    expect(when({ start, dailyHours: { from: "07:00", to: "16:00", days: ["mon", "tue", "wed", "thu", "fri"] } })).toMatchObject({
      hours: { key: "hoursWeekdays", from: "07:00", to: "16:00" },
    });
    expect(when({ start, dailyHours: { from: "22:00", to: "05:00" } })).toMatchObject({ hours: { key: "hoursDaily", from: "22:00", to: "05:00" } });
    expect(when({ start, dailyHours: { from: "10:00", to: "14:00", days: ["sat", "sun"] } })).toMatchObject({
      hours: { key: "hoursDays", days: "Sat, Sun", from: "10:00", to: "14:00" },
    });
  });
});
