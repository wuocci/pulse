import type { CarPark } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import type { CarParks } from "../adapters/digitransit-parking.ts";
import type { StreetParkingSource, StreetSpot } from "../adapters/street-parking.ts";
import { parkingFinder } from "./parking.ts";

const B = { lat: 60.1986, lon: 24.933 };
// A Monday in Helsinki (UTC+2).
const MONDAY_AT = (time: string) => `2026-11-02T${time}:00+02:00`;
const SATURDAY_AT = (time: string) => `2026-11-07T${time}:00+02:00`;
const PAID_9_21 = { weekdays: [540, 1260] as [number, number], sat: [540, 1080] as [number, number] };

const spot = (distanceM: number, patch: Partial<StreetSpot> = {}): StreetSpot => ({ lat: B.lat + distanceM / 111_320, lon: B.lon, distanceM, spaces: 5, kind: "paid", disc: false, ...patch });
const park = (name: string, carSpaces: number, distanceM: number): CarPark => ({ name, lat: B.lat, lon: B.lon, carSpaces, distanceM });

function finderWith(spots: StreetSpot[], parks: CarPark[] = []) {
  const street: StreetParkingSource = { around: async () => spots };
  const carParks: CarParks = { near: async () => parks };
  return parkingFinder({ street, carParks, timeZone: "Europe/Helsinki", credits: { street: "City of Helsinki (CC BY 4.0)", carParks: "HSL / Digitransit" } });
}
const picksAt = async (at: string, spots: StreetSpot[], parks: CarPark[] = []) => (await finderWith(spots, parks).near(B, at))!.picks;

describe("where to park on arrival", () => {
  it("picks the closest spot you may park in, the cheapest too when nothing near costs less", async () => {
    const picks = await picksAt(MONDAY_AT("12:00"), [spot(200, { perHour: 4 }), spot(80, { perHour: 4, paidHours: PAID_9_21, maxStayMin: 240 })]);

    expect(picks).toEqual([
      expect.objectContaining({ reasons: ["closest", "cheapest"], kind: "street", distanceM: 80, cost: "paid", perHour: 4, paidUntil: "21:00", maxStayMin: 240 }),
    ]);
  });

  it("and the cheapest: the nearest free one when the closest costs", async () => {
    const picks = await picksAt(MONDAY_AT("12:00"), [spot(80, { perHour: 4 }), spot(250, { kind: "free", maxStayMin: 120 }), spot(400, { kind: "free" })]);

    expect(picks.map((p) => [p.reasons, p.distanceM, p.cost])).toEqual([
      [["closest"], 80, "paid"],
      [["cheapest"], 250, "free"],
    ]);
  });

  it("counts a paid spot as free outside its paid hours, saying until when", async () => {
    const evening = await picksAt(MONDAY_AT("22:30"), [spot(80, { paidHours: PAID_9_21 })]);
    const morning = await picksAt(MONDAY_AT("07:00"), [spot(80, { paidHours: PAID_9_21 })]);
    const sunday = await picksAt("2026-11-08T12:00:00+02:00", [spot(80, { paidHours: PAID_9_21 })]);

    expect(evening).toEqual([expect.objectContaining({ reasons: ["closest", "cheapest"], cost: "free" })]);
    expect(morning).toEqual([expect.objectContaining({ cost: "free", freeUntil: "09:00" })]);
    expect(sunday[0]!.cost).toBe("free");
  });

  it("reads Saturday's paid hours on a Saturday", async () => {
    const picks = await picksAt(SATURDAY_AT("19:00"), [spot(80, { paidHours: PAID_9_21 })]);

    expect(picks[0]).toMatchObject({ cost: "free" });
  });

  it("picks the lowest price when nothing near is free", async () => {
    const picks = await picksAt(MONDAY_AT("12:00"), [spot(80, { perHour: 4, zone: "1" }), spot(300, { perHour: 2, zone: "2" }), spot(450, { perHour: 2 })]);

    expect(picks.map((p) => [p.reasons, p.distanceM, p.perHour])).toEqual([
      [["closest"], 80, 4],
      [["cheapest"], 300, 2],
    ]);
  });

  it("leaves out spots you can't use: special ones, under an hour, or when parking isn't allowed", async () => {
    const picks = await picksAt(MONDAY_AT("12:00"), [
      spot(10, { kind: "other", type: "ev" }),
      spot(20, { maxStayMin: 30 }),
      spot(30, { kind: "free", noParkingHours: { weekdays: [480, 1020] } }),
      spot(120),
    ]);

    expect(picks.map((p) => p.distanceM)).toEqual([120]);
  });

  it("says when a parking disc is needed", async () => {
    expect((await picksAt(MONDAY_AT("12:00"), [spot(80, { kind: "free", disc: true })]))[0]).toMatchObject({ disc: true });
  });

  it("adds the car park with the most spaces, without saying it has room", async () => {
    const picks = await picksAt(MONDAY_AT("12:00"), [spot(80)], [park("Small", 40, 300), park("REDI", 300, 700)]);

    expect(picks[1]).toEqual(expect.objectContaining({ reasons: ["biggest"], kind: "carPark", name: "REDI", spaces: 300, distanceM: 700, cost: "unknown" }));
  });

  it("says how many spaces the car park has free, and when it's almost full, where it reports them", async () => {
    const free = { spaces: 6, readAt: "2026-11-02T10:00:00.000Z", almostFull: true };
    const picks = await picksAt(MONDAY_AT("12:00"), [], [{ ...park("REDI", 300, 700), free }]);

    expect(picks[0]).toMatchObject({ reasons: ["biggest"], name: "REDI", spaces: 300, free });
    expect((await picksAt(MONDAY_AT("12:00"), [], [park("REDI", 300, 700)]))[0]).not.toHaveProperty("free");
  });

  it("doesn't call a spot cheapest without knowing its price", async () => {
    expect((await picksAt(MONDAY_AT("12:00"), [spot(80)])).map((p) => p.reasons)).toEqual([["closest"]]);
  });

  it("doesn't go further than 300 m for the closest, or 500 m for the cheapest", async () => {
    expect(await picksAt(MONDAY_AT("12:00"), [spot(350, { kind: "free" })])).toEqual([expect.objectContaining({ reasons: ["cheapest"] })]);
    expect(await picksAt(MONDAY_AT("12:00"), [spot(550, { kind: "free" })])).toEqual([]);
  });
});

describe("street parking around B", () => {
  it("sums the spaces within 300 m, and gives each spot for the map", async () => {
    const parking = await finderWith([
      spot(50, { spaces: 10 }),
      spot(100, { kind: "free", spaces: 4 }),
      spot(150, { kind: "other", type: "ev", spaces: 2 }),
      spot(200, { kind: "other", type: "accessible", spaces: 1 }),
      spot(400, { spaces: 50 }),
    ]).near(B, MONDAY_AT("12:00"));

    expect(parking!.street).toMatchObject({ spaces: 17, paid: 10, free: 4, ev: 2, accessible: 1, radiusM: 300 });
    expect(parking!.street!.places.map((p) => [p.spaces, p.kind])).toEqual([
      [10, "paid"],
      [4, "free"],
      [2, "other"],
      [1, "other"],
    ]);
    expect(parking!.sources).toEqual(["City of Helsinki (CC BY 4.0)"]);
  });

  it("tells each spot on the map what it costs on arrival, as the picks do", async () => {
    const parking = await finderWith([
      spot(50, { perHour: 4, paidHours: PAID_9_21, maxStayMin: 240 }),
      spot(100, { kind: "free", disc: true }),
      spot(150, { kind: "other", type: "ev" }),
    ]).near(B, MONDAY_AT("12:00"));

    expect(parking!.street!.places.map(({ lat: _lat, lon: _lon, ...place }) => place)).toEqual([
      { spaces: 5, kind: "paid", cost: "paid", perHour: 4, paidUntil: "21:00", maxStayMin: 240, disc: false },
      { spaces: 5, kind: "free", cost: "free", disc: true },
      { spaces: 5, kind: "other", type: "ev", disc: false },
    ]);
  });

  it("credits the car parks' source when there are any, and says nothing when there's no parking at all", async () => {
    expect((await finderWith([], [park("REDI", 300, 700)]).near(B, MONDAY_AT("12:00")))!.sources).toEqual(["HSL / Digitransit"]);
    expect(await finderWith([]).near(B, MONDAY_AT("12:00"))).toBeUndefined();
  });

  it("still gives what it has when one source fails", async () => {
    const street: StreetParkingSource = { around: async () => Promise.reject(new Error("WFS down")) };
    const carParks: CarParks = { near: async () => [park("REDI", 300, 700)] };
    const finder = parkingFinder({ street, carParks, timeZone: "Europe/Helsinki", credits: { street: "City", carParks: "HSL" } });

    expect((await finder.near(B, MONDAY_AT("12:00")))!.carParks).toHaveLength(1);
  });
});
