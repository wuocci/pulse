import type { Impact, TravelMode } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { recommend } from "./recommend.ts";

// An itinerary arriving `minutes` after 12:00, with an Impact.
const at = (minutes: number, impact: Impact) => ({
  start: "2026-10-31T12:00:00+02:00",
  end: new Date(Date.parse("2026-10-31T12:00:00+02:00") + minutes * 60_000).toISOString(),
  impact,
});
const plan = (mode: TravelMode, ...itineraries: ReturnType<typeof at>[]) => ({ mode, itineraries });

describe("Better today", () => {
  it("recommends nothing when the fastest way is fine", () => {
    expect(recommend([plan("transit", at(20, "minor"), at(25, "none"))])).toBeUndefined();
    expect(recommend([plan("transit", at(20, "none"))])).toBeUndefined();
  });

  it("recommends the earliest way, in any mode, that's less in the way and at most 10 min later", () => {
    const plans = [plan("transit", at(20, "major"), at(28, "consider")), plan("walk"), plan("bike", at(24, "none"))];

    expect(recommend(plans)).toEqual({ mode: "bike", index: 0 });
  });

  it("takes a less affected way even if it's still worth considering", () => {
    expect(recommend([plan("transit", at(20, "major"), at(26, "consider"))])).toEqual({ mode: "transit", index: 1 });
  });

  it("doesn't recommend a way more than 10 min later, or one just as affected", () => {
    expect(recommend([plan("transit", at(20, "consider"), at(31, "none"))])).toBeUndefined();
    expect(recommend([plan("transit", at(20, "consider")), plan("bike", at(22, "consider"))])).toBeUndefined();
  });
});
