import { describe, expect, it, vi } from "vitest";
import { digitransitDirectory } from "./digitransit.ts";
import directoryFixture from "./fixtures/gtfs-rt/hsl-directory.json" with { type: "json" };

const URL_ = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";
const HOUR = 3_600_000;

// Answers as Digitransit does: the stops and routes it knows, null for the ones it doesn't.
function fakeDigitransit({ fail = false } = {}) {
  const asked: { stops: string[]; routes: string[]; key: string | null }[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const { variables } = JSON.parse(String(init?.body)) as { variables: { stops: string[]; routes: string[] } };
    asked.push({ ...variables, key: new Headers(init?.headers).get("digitransit-subscription-key") });
    if (fail) return new Response("Service Unavailable", { status: 503 });
    const data = {
      stops: variables.stops.map((id) => directoryFixture.stops.find((s) => s.gtfsId === id) ?? null),
      routes: variables.routes.map((id) => directoryFixture.routes.find((r) => r.gtfsId === id) ?? null),
    };
    return Response.json({ data });
  });
  return { fetchFn, asked };
}

const KAMPPI = "HSL:1040276";
const TRAM_13 = "HSL:1013";
const UNKNOWN = "HSL:1022K";

describe("the Digitransit stop directory", () => {
  it("looks up stops and routes with the API key, leaving out the ones it doesn't know", async () => {
    const { fetchFn, asked } = fakeDigitransit();
    const directory = digitransitDirectory({ url: URL_, apiKey: "secret", fetchFn });

    const found = await directory.lookup({ stops: [KAMPPI], routes: [TRAM_13, UNKNOWN] });

    expect(found.stops.get(KAMPPI)).toEqual({ name: "Kamppi", lat: 60.169, lon: 24.93164 });
    expect(found.routes.get(TRAM_13)).toEqual({ shortName: "13", mode: "TRAM" });
    expect(found.routes.has(UNKNOWN)).toBe(false);
    expect(asked).toEqual([{ stops: [KAMPPI], routes: [TRAM_13, UNKNOWN], key: "secret" }]);
    expect(fetchFn.mock.calls[0]![0]).toBe(URL_);
  });

  it("remembers what it found, and asks only for ids it hasn't seen", async () => {
    const { fetchFn, asked } = fakeDigitransit();
    const directory = digitransitDirectory({ url: URL_, apiKey: "k", fetchFn });

    await directory.lookup({ stops: [KAMPPI], routes: [TRAM_13] });
    const again = await directory.lookup({ stops: [KAMPPI], routes: [TRAM_13] });
    await directory.lookup({ stops: [KAMPPI, "HSL:1030701"], routes: [] });

    expect(again.stops.get(KAMPPI)?.name).toBe("Kamppi");
    expect(asked.map(({ stops, routes }) => ({ stops, routes }))).toEqual([
      { stops: [KAMPPI], routes: [TRAM_13] },
      { stops: ["HSL:1030701"], routes: [] },
    ]);
  });

  it("asks again about an unknown id only after an hour, in case it has been added", async () => {
    let now = new Date("2026-10-29T08:30:00+02:00");
    const { asked, fetchFn } = fakeDigitransit();
    const directory = digitransitDirectory({ url: URL_, apiKey: "k", fetchFn, clock: () => now });

    await directory.lookup({ stops: [], routes: [UNKNOWN] });
    now = new Date(now.getTime() + HOUR - 1);
    await directory.lookup({ stops: [], routes: [UNKNOWN] });
    now = new Date(now.getTime() + 1);
    await directory.lookup({ stops: [], routes: [UNKNOWN] });

    expect(asked).toHaveLength(2);
  });

  it("answers from what it remembers when Digitransit is down, so alerts still publish", async () => {
    const up = fakeDigitransit();
    const down = fakeDigitransit({ fail: true });
    let fetchFn = up.fetchFn;
    const directory = digitransitDirectory({ url: URL_, apiKey: "k", fetchFn: (...args) => fetchFn(...args) });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await directory.lookup({ stops: [KAMPPI], routes: [] });
    fetchFn = down.fetchFn;
    const found = await directory.lookup({ stops: [KAMPPI, "HSL:1030701"], routes: [TRAM_13] });

    expect([...found.stops.keys()]).toEqual([KAMPPI]);
    expect(found.routes.size).toBe(0);
    expect(error).toHaveBeenCalledOnce();
    // A failure isn't remembered as "unknown": the next lookup asks again.
    await directory.lookup({ stops: ["HSL:1030701"], routes: [] });
    expect(down.asked).toHaveLength(2);
    error.mockRestore();
  });

  it("asks nothing when there is nothing to look up", async () => {
    const { fetchFn } = fakeDigitransit();

    await digitransitDirectory({ url: URL_, apiKey: "k", fetchFn }).lookup({ stops: [], routes: [] });

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
