import type { Event, Leg } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import type { RoutedItinerary } from "../adapters/digitransit-routing.ts";
import { impactOf, matchItinerary } from "./match.ts";

// A leg along latitude 60.17 from 24.93 to 24.94 (about 555 m). 0.00018° of latitude is about 20 m.
const LAT = 60.17;
const NEAR = 0.00018;
const leg = (patch: Partial<Leg> = {}): Leg => ({
  mode: "walk",
  from: { name: "A", lat: LAT, lon: 24.93 },
  to: { name: "B", lat: LAT, lon: 24.94 },
  start: "2026-10-31T12:00:00+02:00",
  end: "2026-10-31T12:10:00+02:00",
  stops: [],
  geometry: { type: "LineString", coordinates: [[24.93, LAT], [24.935, LAT], [24.94, LAT]] },
  ...patch,
});
const itinerary = (...legs: Leg[]): RoutedItinerary => ({
  start: "2026-10-31T12:00:00+02:00",
  end: "2026-10-31T12:30:00+02:00",
  durationS: 1800,
  legs,
});
const TRAM = leg({ mode: "tram", line: { id: "HSL:1005T", name: "5T" }, stops: ["HSL:1", "HSL:2"] });

const event = (id: string, patch: Partial<Event> = {}): Event => ({
  id,
  kind: "works",
  layers: ["area"],
  title: { en: id },
  where: { geometry: { type: "Point", coordinates: [24.935, LAT + NEAR] }, precision: "area" },
  when: { start: "2026-10-01T00:00:00+03:00" },
  severity: "minor",
  mainlyAffected: "unknown",
  noticeable: [],
  status: "active",
  sources: [{ name: "City", id, updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0,
  updatedAt: "2026-10-01T00:00:00+03:00",
  ...patch,
});
const at = (geometry: Event["where"]["geometry"], patch: Partial<Event> = {}) => ({ where: { geometry, precision: "area" as const }, ...patch });
const alert = (id: string, where: Partial<Event["where"]>, patch: Partial<Event> = {}) =>
  event(id, {
    kind: "disruption",
    mainlyAffected: "transit",
    where: { geometry: { type: "Polygon", coordinates: [[[24, 60], [25, 60], [25, 61], [24, 60]]] }, precision: "vague", ...where },
    ...patch,
  });

const matchedIds = (it: RoutedItinerary, events: Event[]) => matchItinerary(it, events).map((m) => m.event.id);

describe("which Events are on an itinerary", () => {
  it("takes what's within 30 m of the route, not what's further", () => {
    const events = [event("near"), event("far", at({ type: "Point", coordinates: [24.935, LAT + 3 * NEAR] }))];

    expect(matchedIds(itinerary(leg()), events)).toEqual(["near"]);
  });

  it("takes a works line or area the route crosses, even with no corner near it", () => {
    const crossing = event("line", at({ type: "LineString", coordinates: [[24.936, LAT - 0.01], [24.936, LAT + 0.01]] }));
    const around = event("area", at({ type: "Polygon", coordinates: [[[24.92, 60.16], [24.95, 60.16], [24.95, 60.18], [24.92, 60.18], [24.92, 60.16]]] }));

    expect(matchedIds(itinerary(leg()), [crossing, around])).toEqual(["line", "area"]);
  });

  it("doesn't take street works beside a train, metro or ferry: those are reached by their own lines and stops", () => {
    const off = (mode: Leg["mode"]) => leg({ mode, line: { id: "HSL:X", name: "X" }, stops: ["HSL:9"] });

    for (const mode of ["rail", "subway", "ferry"] as const) expect(matchedIds(itinerary(off(mode)), [event("dig")])).toEqual([]);
    for (const mode of ["bus", "tram"] as const) expect(matchedIds(itinerary(off(mode)), [event("dig")])).toEqual(["dig"]);
    expect(matchedIds(itinerary(off("rail")), [alert("stop", { stops: ["HSL:9"] })])).toEqual(["stop"]);
  });

  it("doesn't place a region-wide notice on the route by its geometry", () => {
    expect(matchedIds(itinerary(leg()), [event("vague", { where: { geometry: { type: "Point", coordinates: [24.935, LAT] }, precision: "vague" } })])).toEqual([]);
  });

  it("takes an alert for a line the itinerary rides, or a stop it passes, wherever the alert is drawn", () => {
    const events = [
      alert("line", { lines: ["HSL:1005T"] }),
      alert("stop", { stops: ["HSL:2"] }),
      alert("other line", { lines: ["HSL:1006"] }),
    ];

    expect(matchItinerary(itinerary(leg(), TRAM), events).map((m) => [m.event.id, m.legs.map((l) => l.by)])).toEqual([
      ["line", ["line"]],
      ["stop", ["stop"]],
    ]);
  });

  it("only takes what's going on during the trip", () => {
    const events = [
      event("over", { when: { start: "2026-10-01T00:00:00+03:00", end: "2026-10-31T11:00:00+02:00" } }),
      event("later", { when: { start: "2026-10-31T13:00:00+02:00" }, status: "upcoming" }),
      event("resolved", { status: "resolved" }),
      event("during", { when: { start: "2026-10-31T12:20:00+02:00", end: "2026-10-31T18:00:00+02:00" }, status: "upcoming" }),
    ];

    expect(matchedIds(itinerary(leg()), events)).toEqual(["during"]);
  });
});

describe("Impact", () => {
  const impact = (it: RoutedItinerary, ...events: Event[]) => impactOf(matchItinerary(it, events));

  it("is none with nothing on the way", () => {
    expect(impact(itinerary(leg()))).toBe("none");
  });

  it("is major when a line or stop the itinerary uses is badly disrupted", () => {
    expect(impact(itinerary(TRAM), alert("a", { lines: ["HSL:1005T"] }, { severity: "major" }))).toBe("major");
    expect(impact(itinerary(TRAM), alert("a", { stops: ["HSL:1"] }, { noticeable: ["outage"] }))).toBe("major");
  });

  it("is consider when it's in the way of how that part is travelled, or blocks the way", () => {
    expect(impact(itinerary(leg()), event("a", { mainlyAffected: "pedestrians" }))).toBe("consider");
    expect(impact(itinerary(leg({ mode: "bike" })), event("a", { mainlyAffected: "cyclists" }))).toBe("consider");
    expect(impact(itinerary(TRAM), event("a", { mainlyAffected: "transit" }))).toBe("consider");
    expect(impact(itinerary(TRAM), alert("a", { lines: ["HSL:1005T"] }))).toBe("consider");
    expect(impact(itinerary(leg()), event("a", { mainlyAffected: "everyone" }))).toBe("consider");
    expect(impact(itinerary(leg()), event("a", { noticeable: ["blocked"] }))).toBe("consider");
  });

  it("is minor for the rest, e.g. a closure for drivers next to a walk", () => {
    expect(impact(itinerary(leg()), event("a", { mainlyAffected: "drivers" }))).toBe("minor");
    expect(impact(itinerary(leg({ mode: "bike" })), event("a", { mainlyAffected: "pedestrians" }))).toBe("minor");
  });

  it("is the worst of what's on the way", () => {
    expect(impact(itinerary(leg(), TRAM), event("a", { mainlyAffected: "drivers" }), alert("b", { lines: ["HSL:1005T"] }, { severity: "major" }))).toBe(
      "major",
    );
  });
});
