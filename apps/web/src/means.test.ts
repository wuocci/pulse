import type { Event } from "@pulse/client";
import { describe, expect, it } from "vitest";
import { meansOf } from "./means.ts";
import { parsePlaces } from "./places.ts";

const anEvent = (patch: Partial<Event>): Event => ({
  id: "e",
  kind: "works",
  layers: ["area"],
  title: { en: "Works" },
  where: { geometry: { type: "Point", coordinates: [24.95, 60.17] }, precision: "exact" },
  when: { start: "2026-10-01T00:00:00+03:00" },
  severity: "consider",
  mainlyAffected: "unknown",
  noticeable: [],
  status: "active",
  sources: [{ name: "City", id: "e", updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0,
  updatedAt: "2026-10-01T00:00:00+03:00",
  ...patch,
});

describe("what an Event means for you", () => {
  it("names the lines of a transit alert, and says when a stop is out of service", () => {
    expect(meansOf(anEvent({ kind: "disruption", where: { geometry: { type: "Point", coordinates: [0, 0] }, precision: "exact", lineNames: ["550", "560"] } }))).toEqual({
      key: "means_lineChanges",
      lines: "550, 560",
    });
    expect(
      meansOf(anEvent({ kind: "disruption", noticeable: ["outage"], where: { geometry: { type: "Point", coordinates: [0, 0] }, precision: "exact", lineNames: ["1", "2", "3", "4", "5"] } })),
    ).toEqual({ key: "means_noService", lines: "1, 2, 3 +2" });
  });

  it("says what a traffic arrangement changes, though it's published as a closure", () => {
    expect(meansOf(anEvent({ kind: "closure", arrangementType: "stop_moved" })).key).toBe("means_arrangement_stop_moved");
    expect(meansOf(anEvent({ kind: "closure", arrangementType: "other", noticeable: ["blocked"] })).key).toBe("means_partlyBlocked");
    expect(meansOf(anEvent({ kind: "closure", mainlyAffected: "drivers" })).key).toBe("means_closedToCars");
  });

  it("says who works get in the way of, and whether they're noisy", () => {
    expect(meansOf(anEvent({ mainlyAffected: "pedestrians", noticeable: ["noise"] }))).toEqual({ key: "means_who_pedestrians", noisy: true });
    expect(meansOf(anEvent({ noticeable: ["noise"] })).key).toBe("means_noisy");
    expect(meansOf(anEvent({})).key).toBe("means_works");
  });

  it("calls a public event a crowd when it draws one", () => {
    expect(meansOf(anEvent({ kind: "public_event", noticeable: ["crowd", "noise"] })).key).toBe("means_crowds");
  });
});

describe("saved places", () => {
  it("keeps well-formed places, at most five, and drops the rest", () => {
    const stored = JSON.stringify([
      { name: "Home", lat: 60.18, lon: 24.95, extra: true },
      { name: "", lat: 60, lon: 24 },
      { name: "Bad", lat: "x", lon: 24 },
      ...["A", "B", "C", "D", "E"].map((name) => ({ name, lat: 60, lon: 24 })),
    ]);
    expect(parsePlaces(stored).map((p) => p.name)).toEqual(["Home", "A", "B", "C", "D"]);
    expect(parsePlaces(stored)[0]).toEqual({ name: "Home", lat: 60.18, lon: 24.95 });
  });

  it("is empty when nothing or something unreadable is stored", () => {
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces("{not json")).toEqual([]);
    expect(parsePlaces('{"name":"Home"}')).toEqual([]);
  });
});
