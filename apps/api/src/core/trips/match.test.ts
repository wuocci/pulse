import { readFileSync } from "node:fs";
import type { Event, Leg } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { readFeed, toEvents } from "../adapters/cap.ts";
import type { RoutedItinerary } from "../adapters/digitransit-routing.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import type { CapSource } from "../regions/index.ts";
import { impactOf, impactOfMatch, matchItinerary } from "./match.ts";

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

  it("looks wider beside a car leg: a motorway's two carriageways are drawn apart", () => {
    const beside = event("45 m off", at({ type: "Point", coordinates: [24.935, LAT + 0.0004] }));

    expect(matchedIds(itinerary(leg({ mode: "car" })), [beside])).toEqual(["45 m off"]);
    expect(matchedIds(itinerary(leg()), [beside])).toEqual([]);
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

  it("takes an alert that names lines only for a leg riding one of them, not at a shared stop or walking by", () => {
    const otherLines = alert("E and L trains", { lines: ["HSL:3002E", "HSL:3002L"], stops: ["HSL:2"], geometry: { type: "Point", coordinates: [24.935, LAT] }, precision: "exact" });

    expect(matchedIds(itinerary(leg(), TRAM), [otherLines])).toEqual([]);
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

describe("where the trip meets an Event", () => {
  it("is the point of the route nearest the Event, and how many minutes in the trip gets there", () => {
    // 20 m north of the leg's middle: 5 min into its 10.
    const [match] = matchItinerary(itinerary(leg()), [event("dig")]);

    expect(match).toMatchObject({ leg: 0, minutes: 5 });
    expect(match!.at[0]).toBeCloseTo(24.935, 4);
    expect(match!.at[1]).toBeCloseTo(LAT, 4);
  });

  it("counts from the itinerary's start, on the first leg the Event is on", () => {
    const second = leg({ start: "2026-10-31T12:20:00+02:00", end: "2026-10-31T12:30:00+02:00" });
    const first = leg({ geometry: { type: "LineString", coordinates: [[24.9, 60.1], [24.91, 60.1]] }, from: { name: "X", lat: 60.1, lon: 24.9 } });

    expect(matchItinerary(itinerary(first, second), [event("dig")])[0]).toMatchObject({ leg: 1, minutes: 25 });
  });

  it("is where an area the route runs through begins", () => {
    const around = event("area", at({ type: "Polygon", coordinates: [[[24.938, 60.16], [24.95, 60.16], [24.95, 60.18], [24.938, 60.18], [24.938, 60.16]]] }));

    const [match] = matchItinerary(itinerary(leg()), [around]);

    expect(match!.at[0]).toBeCloseTo(24.938, 3);
    expect(match!.minutes).toBe(8);
  });

  it("is where the leg begins for an alert on its line or stop", () => {
    expect(matchItinerary(itinerary(TRAM), [alert("line", { lines: ["HSL:1005T"] })])[0]).toMatchObject({ leg: 0, minutes: 0, at: [24.93, LAT] });
  });
});

describe("what's coming up on the route", () => {
  it("is what's on it in a window instead of during the trip, whatever its daily hours", () => {
    const nextWeek = event("next week", { when: { start: "2026-11-05T00:00:00+02:00", dailyHours: { from: "22:00", to: "06:00" } }, status: "upcoming" });
    const window = { start: Date.parse("2026-10-31T12:30:00+02:00"), end: Date.parse("2026-11-07T12:00:00+02:00") };

    expect(matchedIds(itinerary(leg()), [nextWeek])).toEqual([]);
    expect(matchItinerary(itinerary(leg()), [nextWeek], { window }).map((m) => m.event.id)).toEqual(["next week"]);
  });
});

describe("an Event's own daily hours", () => {
  // 12:00–12:30 in Helsinki; the leg passes the works.
  const night = event("night closure", { when: { start: "2026-10-01T00:00:00+03:00", dailyHours: { from: "22:00", to: "06:00", days: ["fri", "sat"] } } });
  const at = (start: string, end: string): RoutedItinerary => ({ ...itinerary(leg()), start, end });
  const options = { timeZone: "Europe/Helsinki" };

  it("leave out what's off while the trip passes", () => {
    expect(matchItinerary(at("2026-10-31T12:00:00+02:00", "2026-10-31T12:30:00+02:00"), [night], options)).toEqual([]);
  });

  it("take what's on at any point of the trip, past midnight too", () => {
    expect(matchItinerary(at("2026-10-31T21:50:00+02:00", "2026-10-31T22:20:00+02:00"), [night], options)).toHaveLength(1);
    expect(matchItinerary(at("2026-11-01T05:30:00+02:00", "2026-11-01T06:10:00+02:00"), [night], options)).toHaveLength(1);
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

  it("is consider when it's in the way of those travelling that part, and it matters: worth considering or blocking", () => {
    const matters = { severity: "consider" as const };
    expect(impact(itinerary(leg()), event("a", { mainlyAffected: "pedestrians", ...matters }))).toBe("consider");
    expect(impact(itinerary(leg({ mode: "bike" })), event("a", { mainlyAffected: "cyclists", noticeable: ["blocked"] }))).toBe("consider");
    expect(impact(itinerary(TRAM), event("a", { mainlyAffected: "transit", ...matters }))).toBe("consider");
    expect(impact(itinerary(TRAM), alert("a", { lines: ["HSL:1005T"] }, matters))).toBe("consider");
    expect(impact(itinerary(leg()), event("a", { mainlyAffected: "everyone", ...matters }))).toBe("consider");
    expect(impact(itinerary(leg()), event("a", { noticeable: ["blocked"] }))).toBe("consider");
  });

  it("is minor when it's for them but doesn't matter much: a notice on the line, a slower stretch of road", () => {
    expect(impact(itinerary(TRAM), alert("a", { lines: ["HSL:1005T"] }, { severity: "info" }))).toBe("minor");
    expect(impact(itinerary(leg({ mode: "car" })), event("a", { mainlyAffected: "drivers", severity: "minor" }))).toBe("minor");
  });

  it("leaves out what its Source says is in nobody's way", () => {
    expect(matchedIds(itinerary(leg()), [event("a", { mainlyAffected: "nobody", noticeable: ["blocked"] })])).toEqual([]);
  });

  it("is major for a car when the road is closed, consider when drivers are in the way", () => {
    const car = itinerary(leg({ mode: "car" }));

    expect(impact(car, event("a", { severity: "major", noticeable: ["blocked"], mainlyAffected: "drivers" }))).toBe("major");
    expect(impact(car, event("a", { mainlyAffected: "drivers", severity: "consider" }))).toBe("consider");
    expect(impact(car, event("a", { mainlyAffected: "pedestrians" }))).toBe("minor");
  });

  it("is minor for a car when works block something but don't say who: a street dig mostly blocks the pavement", () => {
    const dig = event("dig", { noticeable: ["blocked"] });

    expect(impact(itinerary(leg({ mode: "car" })), dig)).toBe("minor");
    expect(impact(itinerary(leg()), dig)).toBe("consider");
    expect(impact(itinerary(leg({ mode: "car" })), event("closed", { noticeable: ["blocked"], mainlyAffected: "everyone" }))).toBe("consider");
  });

  it("is minor for the rest, e.g. a closure for drivers next to a walk", () => {
    expect(impact(itinerary(leg()), event("a", { mainlyAffected: "drivers" }))).toBe("minor");
    expect(impact(itinerary(leg({ mode: "bike" })), event("a", { mainlyAffected: "pedestrians" }))).toBe("minor");
  });

  it("is told for each Event too", () => {
    const [drivers, closed] = matchItinerary(itinerary(leg()), [event("a", { mainlyAffected: "drivers" }), event("b", { noticeable: ["blocked"] })]);

    expect([impactOfMatch(drivers!), impactOfMatch(closed!)]).toEqual(["minor", "consider"]);
  });

  it("is the worst of what's on the way", () => {
    expect(impact(itinerary(leg(), TRAM), event("a", { mainlyAffected: "drivers" }), alert("b", { lines: ["HSL:1005T"] }, { severity: "major" }))).toBe(
      "major",
    );
  });
});

describe("weather warnings", () => {
  // Real FMI warnings (fixtures/cap): orange slippery roads over the south of Finland, 26 Feb 00–24, for drivers;
  // yellow slippery pavements over the west including Uusimaa, 26 Feb 16–24, for pedestrians.
  const fmi = fiCapitalRegion.sources.find((s): s is CapSource => s.adapter === "cap")!;
  const archive = readFeed(readFileSync(new URL("../adapters/fixtures/cap/fmi-archive-2026.xml", import.meta.url), "utf8")).alerts;
  const [orangeRoads, pavements] = toEvents(archive.slice(4), { source: fmi, region: fiCapitalRegion, now: new Date("2026-02-26T15:00:00Z") }) as [Event, Event];
  const evening = { start: "2026-02-26T19:00:00+02:00", end: "2026-02-26T19:10:00+02:00" };
  const onTheEvening = (...legs: Leg[]): RoutedItinerary => ({ ...itinerary(...legs), ...evening, durationS: 600 });
  const inHelsinki = (mode: Leg["mode"]) => onTheEvening(leg({ mode, ...evening }));
  const inOulu = onTheEvening(
    leg({ mode: "car", ...evening, geometry: { type: "LineString", coordinates: [[25.46, 65.01], [25.47, 65.01]] }, from: { name: "A", lat: 65.01, lon: 25.46 }, to: { name: "B", lat: 65.01, lon: 25.47 } }),
  );

  it("are on a route that runs inside the warning area, not on one outside it", () => {
    expect(orangeRoads.severity).toBe("major");
    expect(matchedIds(inHelsinki("car"), [orangeRoads])).toEqual([orangeRoads.id]);
    expect(matchedIds(inOulu, [orangeRoads, pavements])).toEqual([]);
  });

  it("are major at orange for those they're for, consider at yellow, minor for the rest", () => {
    const impact = (it: RoutedItinerary, warning: Event) => impactOf(matchItinerary(it, [warning]));

    expect(impact(inHelsinki("car"), orangeRoads)).toBe("major");
    expect(impact(inHelsinki("walk"), orangeRoads)).toBe("minor");
    expect(impact(inHelsinki("walk"), pavements)).toBe("consider");
    expect(impact(inHelsinki("car"), pavements)).toBe("minor");
  });

  it("leave out what's in nobody's way (sea warnings)", () => {
    expect(matchedIds(inHelsinki("walk"), [{ ...pavements, mainlyAffected: "nobody" }])).toEqual([]);
  });

  it("are on the whole way when the trip starts and ends in the area, not when it only runs into it", () => {
    const toOulu = onTheEvening(leg({ mode: "car", ...evening, geometry: { type: "LineString", coordinates: [[24.93, LAT], [25.46, 65.01]] }, to: { name: "B", lat: 65.01, lon: 25.46 } }));

    expect(matchItinerary(inHelsinki("car"), [orangeRoads])[0]).toMatchObject({ wholeWay: true });
    expect(matchItinerary(toOulu, [orangeRoads])[0]).toMatchObject({ wholeWay: false });
    expect(matchItinerary(inHelsinki("car"), [event("dig", { when: { start: "2026-02-01T00:00:00+02:00" } })])[0]).toMatchObject({ wholeWay: false });
  });

  it("are placed on the first part of the trip they're for", () => {
    const walkThenDrive = onTheEvening(leg({ mode: "walk", ...evening }), leg({ mode: "car", ...evening }));

    expect(matchItinerary(walkThenDrive, [orangeRoads])[0]).toMatchObject({ leg: 1 });
    expect(matchItinerary(walkThenDrive, [pavements])[0]).toMatchObject({ leg: 0 });
  });

  it("reach a train, metro or ferry when they're for those riding", () => {
    const ferry = onTheEvening(leg({ mode: "ferry", line: { id: "HSL:1019", name: "Suomenlinna" }, ...evening }));
    const storm = { ...pavements, id: "fmi:storm", mainlyAffected: "everyone" as const };

    expect(matchedIds(ferry, [storm, pavements, orangeRoads])).toEqual(["fmi:storm"]);
    expect(impactOf(matchItinerary(ferry, [storm]))).toBe("consider");
  });

  it("are minor for those they're not for, whatever else they say", () => {
    const blocking = { ...orangeRoads, mainlyAffected: "pedestrians" as const, noticeable: ["blocked" as const] };

    expect(impactOf(matchItinerary(inHelsinki("car"), [blocking]))).toBe("minor");
  });
});
