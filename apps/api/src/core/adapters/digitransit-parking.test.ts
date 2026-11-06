import { describe, expect, it, vi } from "vitest";
import { digitransitCarParks, freeSpaces } from "./digitransit-parking.ts";
import parkings from "./fixtures/digitransit-routing/parkings.json" with { type: "json" };

const URL_ = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";
const PASILA = { lat: 60.1986, lon: 24.933 };
const MATINKYLA = { lat: 60.1597, lon: 24.7387 };
// A park-and-ride with 0 of 36 free when recorded.
const UKKO_PEKAN = { lat: 60.1888818, lon: 25.0058927 };
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
    expect(listReads(fetchFn)).toBe(1);
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get("digitransit-subscription-key")).toBe("secret");

    now = new Date(now.getTime() + 2);
    await parks.near(PASILA);
    expect(listReads(fetchFn)).toBe(2);
  });

  it("gives the free spaces of a car park that reports them, as read", async () => {
    const now = new Date("2026-11-06T08:00:00Z");
    const [matinkyla] = await digitransitCarParks({ url: URL_, apiKey: "k", fetchFn: fakeDigitransit(), clock: () => now }).near(MATINKYLA);

    expect(matinkyla).toMatchObject({ name: "Matinkylän asema", carSpaces: 350, free: { spaces: 174, readAt: now.toISOString(), almostFull: false } });
  });

  it("says when one is almost full, and gives none for a car park that doesn't report it", async () => {
    const parks = digitransitCarParks({ url: URL_, apiKey: "k", fetchFn: fakeDigitransit() });

    expect((await parks.near(UKKO_PEKAN, { radiusM: 10 }))[0]?.free).toMatchObject({ spaces: 0, almostFull: true });
    const quiet = parkings.data.vehicleParkings.find((p) => !p.realtime)!;
    expect((await parks.near(quiet, { radiusM: 0 }))[0]).not.toHaveProperty("free");
  });

  it("reads the counts every 5 minutes, only when there's a car park near", async () => {
    let now = new Date("2026-11-06T08:00:00Z");
    const fetchFn = fakeDigitransit();
    const parks = digitransitCarParks({ url: URL_, apiKey: "k", fetchFn, clock: () => now });

    await parks.near(PASILA);
    expect(liveReads(fetchFn)).toBe(0);
    await parks.near(MATINKYLA);
    now = new Date(now.getTime() + 5 * 60_000 - 1);
    await parks.near(MATINKYLA);
    expect(liveReads(fetchFn)).toBe(1);
    now = new Date(now.getTime() + 2);
    await parks.near(MATINKYLA);
    expect(liveReads(fetchFn)).toBe(2);
  });

  it("keeps the last counts when a read fails, until they're 30 minutes old, and still gives the car parks", async () => {
    let now = new Date("2026-11-06T08:00:00Z");
    let failing = false;
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      failing && String(init?.body).includes("availability") ? new Response("", { status: 503 }) : Response.json(parkings),
    );
    const parks = digitransitCarParks({ url: URL_, apiKey: "k", fetchFn, clock: () => now });
    await parks.near(MATINKYLA);
    failing = true;

    now = new Date("2026-11-06T08:29:00Z");
    expect((await parks.near(MATINKYLA))[0]?.free).toMatchObject({ spaces: 174, readAt: "2026-11-06T08:00:00.000Z" });
    now = new Date("2026-11-06T08:30:00Z");
    const [stale] = await parks.near(MATINKYLA);
    expect(stale).toMatchObject({ name: "Matinkylän asema" });
    expect(stale).not.toHaveProperty("free");
  });

  it("calls almost full 10 or fewer free, or under 5% of the spaces", () => {
    const at = new Date("2026-11-06T08:00:00Z");
    const almostFull = (spaces: number, capacity: number) => freeSpaces(spaces, capacity, at).almostFull;

    expect(almostFull(10, 100)).toBe(true);
    expect(almostFull(11, 100)).toBe(false);
    expect(almostFull(101, 2049)).toBe(true);
    expect(almostFull(103, 2049)).toBe(false);
  });
});

const bodies = (fetchFn: ReturnType<typeof fakeDigitransit>) => fetchFn.mock.calls.map(([, init]) => String(init?.body));
const listReads = (fetchFn: ReturnType<typeof fakeDigitransit>) => bodies(fetchFn).filter((b) => b.includes("capacity")).length;
const liveReads = (fetchFn: ReturnType<typeof fakeDigitransit>) => bodies(fetchFn).filter((b) => b.includes("availability")).length;
