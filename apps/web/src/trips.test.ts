import type { Event, Schema } from "@pulse/client";
import { describe, expect, it } from "vitest";
import { avoidedBy, bestOf, mapsLinks, onApple, parkingWalkMin, stepsOf } from "./trips.ts";

type Trip = Schema<"Trip">;
type Itinerary = Trip["plans"][number]["itineraries"][number];
type Leg = Itinerary["legs"][number];

const leg = (mode: Leg["mode"], coordinates: [number, number][], to = { name: "B", lat: 60.19, lon: 24.94 }): Leg => ({
  mode,
  from: { name: "A", lat: 60.17, lon: 24.95 },
  to,
  start: "2026-10-31T12:00:00+02:00",
  end: "2026-10-31T12:10:00+02:00",
  stops: [],
  geometry: { type: "LineString", coordinates },
});
const way = (end: string, legs: Leg[], onTheWay: string[] = []): Itinerary => ({
  start: "2026-10-31T12:00:00+02:00",
  end,
  durationS: (Date.parse(end) - Date.parse("2026-10-31T12:00:00+02:00")) / 1000,
  legs,
  eventIds: onTheWay,
  onTheWay: onTheWay.map((eventId) => ({ eventId, impact: "consider", leg: 0, at: [24.945, 60.18], minutes: 3 })),
  comingUp: [],
  impact: onTheWay.length ? "consider" : "none",
});
const dig = { id: "dig", title: { en: "Hämeentie closed" }, severity: "major" } as unknown as Event;
const FROM = { lat: 60.17, lon: 24.95 };
const TO = { lat: 60.19, lon: 24.94 };
const STRAIGHT: [number, number][] = [[24.95, 60.17], [24.945, 60.18], [24.94, 60.19]];
const ROUND: [number, number][] = [[24.95, 60.17], [24.93, 60.18], [24.94, 60.19]];

describe("the recommendation", () => {
  const tram = way("2026-10-31T12:15:00+02:00", [leg("tram", STRAIGHT)], ["dig"]);
  const bus = way("2026-10-31T12:20:00+02:00", [leg("bus", STRAIGHT)]);
  const bike = way("2026-10-31T12:25:00+02:00", [leg("bike", STRAIGHT)]);

  it("is the fastest way in any mode, with no reason given: it's the obvious advice", () => {
    const trip = { events: [], plans: [{ mode: "bike" as const, itineraries: [bike] }, { mode: "transit" as const, itineraries: [bus, tram] }] };

    expect(bestOf(trip)).toEqual({ mode: "transit", index: 1 });
    expect(avoidedBy(trip, bestOf(trip))).toBeUndefined();
  });

  it("counts a drive's walk from the closest parking at B, so the car isn't always fastest", () => {
    const drive = way("2026-10-31T12:14:00+02:00", [leg("car", STRAIGHT)]);
    const quick = way("2026-10-31T12:16:00+02:00", [leg("tram", STRAIGHT)]);
    const parking = { picks: [{ reasons: ["closest"], kind: "street", lat: 60.19, lon: 24.94, distanceM: 300, spaces: 4, cost: "paid", disc: false }], sources: [] } as unknown as Trip["parking"];
    const trip = { events: [], plans: [{ mode: "car" as const, itineraries: [drive] }, { mode: "transit" as const, itineraries: [quick] }] };

    expect(bestOf(trip)).toEqual({ mode: "car", index: 0 });
    expect(bestOf({ ...trip, parking })).toEqual({ mode: "transit", index: 0 });
  });

  it("times the walk from parking at how fast you walk", () => {
    const drive = way("2026-10-31T12:14:00+02:00", [leg("car", STRAIGHT)]);
    const parking = { picks: [{ reasons: ["closest"], kind: "street", lat: 60.19, lon: 24.94, distanceM: 300, spaces: 4, cost: "paid", disc: false }], sources: [] } as unknown as Trip["parking"];
    const trip = { events: [], plans: [{ mode: "car" as const, itineraries: [drive] }], parking };

    expect(parkingWalkMin(trip, "car", drive)).toBe(4);
    expect(parkingWalkMin({ ...trip, walkKmh: 6 }, "car", drive)).toBe(3);
  });

  it("arriving by a time, is the way that lets you leave latest, not the one that arrives first", () => {
    // Arrive by 09:00: leave 08:05 and wait 17 min, or leave 08:14 and arrive 08:54.
    const ride = (start: string, end: string, changes: number): Itinerary => ({
      ...way(`2026-10-31T${end}:00+02:00`, Array.from({ length: changes + 1 }, () => ({ ...leg("tram", STRAIGHT), line: { id: "HSL:12", name: "12" } }))),
      start: `2026-10-31T${start}:00+02:00`,
    });
    const early = ride("08:05", "08:43", 1);
    const late = ride("08:14", "08:54", 1);
    const arriveBy = Date.parse("2026-10-31T09:00:00+02:00");
    const trip = { events: [], plans: [{ mode: "transit" as const, itineraries: [late, early] }] };

    expect(bestOf(trip)).toEqual({ mode: "transit", index: 1 });
    expect(bestOf({ ...trip, arriveBy })).toEqual({ mode: "transit", index: 0 });
    // Leaving at the same time: the earlier arrival, then fewer changes.
    const direct = ride("08:14", "08:54", 0);
    expect(bestOf({ ...trip, arriveBy, plans: [{ mode: "transit", itineraries: [late, direct] }] })).toEqual({ mode: "transit", index: 1 });
  });

  it("arriving by a time, puts last a drive whose walk from parking gets you there too late", () => {
    const drive = { ...way("2026-10-31T08:58:00+02:00", [leg("car", STRAIGHT)]), start: "2026-10-31T08:40:00+02:00" };
    const tram = { ...way("2026-10-31T08:55:00+02:00", [leg("tram", STRAIGHT)]), start: "2026-10-31T08:20:00+02:00" };
    const parking = { picks: [{ reasons: ["closest"], kind: "street", lat: 60.19, lon: 24.94, distanceM: 450, spaces: 4, cost: "paid", disc: false }], sources: [] } as unknown as Trip["parking"];
    const trip = { events: [], plans: [{ mode: "car" as const, itineraries: [drive] }, { mode: "transit" as const, itineraries: [tram] }], parking, arriveBy: Date.parse("2026-10-31T09:00:00+02:00") };

    expect(bestOf(trip)).toEqual({ mode: "transit", index: 0 });
  });

  it("is the way that's better today when the fastest has something in it, and says what it avoids", () => {
    const trip = { events: [dig], plans: [{ mode: "transit" as const, itineraries: [tram, bus] }], recommended: { mode: "transit" as const, index: 1 } };

    expect(bestOf(trip)).toEqual({ mode: "transit", index: 1 });
    expect(avoidedBy(trip, bestOf(trip))?.id).toBe("dig");
  });
});

describe("Open in Maps", () => {
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it("hands public transport, walking and cycling to the destination with the mode", () => {
    const links = mapsLinks({ from: FROM, to: TO, way: { mode: "transit", index: 0 }, itinerary: way("2026-10-31T12:15:00+02:00", [leg("tram", STRAIGHT)]), apple: true });

    expect(params(links.google)).toEqual({ api: "1", origin: "60.17,24.95", destination: "60.19,24.94", travelmode: "transit" });
    expect(params(links.apple!)).toEqual({ saddr: "60.17,24.95", daddr: "60.19,24.94", dirflg: "r" });
    expect(links.steered).toBe(false);
  });

  it("drives to where you'll leave the car: the closest parking at B", () => {
    const drive = way("2026-10-31T12:15:00+02:00", [leg("car", STRAIGHT)]);
    const pick = { reasons: ["closest"], kind: "street", lat: 60.199, lon: 24.933, distanceM: 80, spaces: 4, cost: "paid", disc: false } as NonNullable<Trip["parking"]>["picks"][number];

    const links = mapsLinks({ from: FROM, to: TO, way: { mode: "car", index: 0 }, itinerary: drive, plainDrive: drive, parking: pick, apple: false });

    expect(params(links.google)).toMatchObject({ destination: "60.199,24.933", travelmode: "driving" });
    expect(links.apple).toBeUndefined();
  });

  it("drives to the car park on a park-and-ride way", () => {
    const parkAndRide = way("2026-10-31T12:30:00+02:00", [leg("car", STRAIGHT, { name: "Niittykumpu", lat: 60.17, lon: 24.76 }), leg("subway", STRAIGHT)]);

    const links = mapsLinks({ from: FROM, to: TO, way: { mode: "car", index: 1 }, itinerary: parkAndRide, apple: false });

    expect(params(links.google)).toMatchObject({ destination: "60.17,24.76", travelmode: "driving" });
  });

  it("makes Google Maps take the way round through its turn; Apple Maps can't be told", () => {
    const drive = way("2026-10-31T12:15:00+02:00", [leg("car", STRAIGHT)], ["dig"]);
    const round = way("2026-10-31T12:18:00+02:00", [leg("car", ROUND)]);

    const links = mapsLinks({ from: FROM, to: TO, way: { mode: "car", index: 1 }, itinerary: round, plainDrive: drive, apple: true });

    expect(params(links.google).waypoints).toBe("60.18,24.93");
    expect(params(links.apple!).daddr).toBe("60.19,24.94");
    expect(links.steered).toBe(true);
  });

  it("offers Apple Maps on Apple devices only", () => {
    expect(onApple("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(onApple("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe(false);
  });
});

describe("a way step by step", () => {
  const at = (name: string, lat: number) => ({ name, lat, lon: 24.94 });
  const ride = (mode: Leg["mode"], from: ReturnType<typeof at>, to: ReturnType<typeof at>, start: string, end: string, line?: string, stops: string[] = []): Leg => ({
    ...leg(mode, STRAIGHT, to),
    from,
    start: `2026-10-31T${start}:00+02:00`,
    end: `2026-10-31T${end}:00+02:00`,
    stops,
    ...(line ? { line: { id: `HSL:${line}`, name: line } } : {}),
  });
  const names = { from: "Home", to: "Arabia" };
  const kinds = (steps: ReturnType<typeof stepsOf>) => steps.map((s) => (s.kind === "move" ? `${s.mode} ${s.minutes}${s.stops ? `/${s.stops}` : ""}` : `${s.kind} ${s.name}`));

  it("lists where you get on and off, a change of lines once, and how long between", () => {
    const [home, kala, kulo, stop, arabia] = [at("Home", 60.17), at("Kalasatama", 60.18), at("Kulosaari", 60.185), at("Arabia stop", 60.2), at("Arabia", 60.21)];
    const itinerary = way("2026-10-31T12:40:00+02:00", [
      ride("walk", home, kala, "12:00", "12:05"),
      ride("bus", kala, kulo, "12:06", "12:20", "11", ["s1", "s2", "s3"]),
      ride("bus", kulo, stop, "12:22", "12:35", "87", ["s4", "s5"]),
      ride("walk", stop, arabia, "12:35", "12:40"),
    ]);

    expect(kinds(stepsOf(itinerary, names, Date.parse(itinerary.end)))).toEqual([
      "start Home",
      "walk 5",
      "board Kalasatama",
      "bus 14/2",
      "board Kulosaari",
      "bus 13/1",
      "off Arabia stop",
      "walk 5",
      "end Arabia",
    ]);
  });

  it("parks a drive at the closest parking, and walks the rest", () => {
    const drive = way("2026-10-31T12:14:00+02:00", [ride("car", at("Home", 60.17), at("Arabia", 60.21), "12:00", "12:14")]);
    const pick = { reasons: ["closest"], kind: "street", lat: 60.209, lon: 24.93, distanceM: 400, spaces: 4, cost: "paid", disc: false } as NonNullable<Trip["parking"]>["picks"][number];

    const steps = stepsOf(drive, { ...names, parking: "Parking" }, Date.parse("2026-10-31T12:20:00+02:00"), pick);

    expect(kinds(steps)).toEqual(["start Home", "car 14", "park Parking", "walk 6", "end Arabia"]);
    expect(steps[2]).toMatchObject({ at: { lat: 60.209, lon: 24.93 } });
  });
});
