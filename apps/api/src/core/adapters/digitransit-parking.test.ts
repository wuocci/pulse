import { describe, expect, it, vi } from "vitest";
import { digitransitCarParks } from "./digitransit-parking.ts";
import parkings from "./fixtures/digitransit-routing/parkings.json" with { type: "json" };

const URL_ = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";
const PASILA = { lat: 60.1986, lon: 24.933 };
const MATINKYLA = { lat: 60.1597, lon: 24.7387 };
const DAY = 86_400_000;

function fakeDigitransit() {
  const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(parkings));
  return fetchFn;
}

describe("Digitransit's car parks", () => {
  it("gives the nearest car parks within a kilometre, nearest first, at most three", async () => {
    const parks = await digitransitCarParks({ url: URL_, apiKey: "k", fetchFn: fakeDigitransit() }).near(MATINKYLA);

    expect(parks.length).toBeGreaterThan(0);
    expect(parks.length).toBeLessThanOrEqual(3);
    expect(parks.map((p) => p.distanceM)).toEqual([...parks.map((p) => p.distanceM)].sort((a, b) => a - b));
    for (const park of parks) {
      expect(park.distanceM).toBeLessThanOrEqual(1000);
      expect(park.carSpaces).toBeGreaterThan(0);
    }
  });

  it("finds few in the city centre: they're mostly park-and-ride in the suburbs", async () => {
    const parks = await digitransitCarParks({ url: URL_, apiKey: "k", fetchFn: fakeDigitransit() }).near(PASILA);

    expect(parks).toEqual([]);
  });

  it("loads the list once a day, with the key", async () => {
    let now = new Date("2026-11-01T08:00:00Z");
    const fetchFn = fakeDigitransit();
    const parks = digitransitCarParks({ url: URL_, apiKey: "secret", fetchFn, clock: () => now });

    await Promise.all([parks.near(PASILA), parks.near(MATINKYLA)]);
    now = new Date(now.getTime() + DAY - 1);
    await parks.near(PASILA);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get("digitransit-subscription-key")).toBe("secret");

    now = new Date(now.getTime() + 2);
    await parks.near(PASILA);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
