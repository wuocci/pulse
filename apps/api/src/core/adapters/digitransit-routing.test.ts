import { describe, expect, it, vi } from "vitest";
import { digitransitRouter } from "./digitransit-routing.ts";
import bike from "./fixtures/digitransit-routing/bike.json" with { type: "json" };
import transit from "./fixtures/digitransit-routing/transit.json" with { type: "json" };

const URL_ = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";
const KAMPPI = { lat: 60.169, lon: 24.9316 };
const PASILA = { lat: 60.1986, lon: 24.933 };
const departAt = "2026-10-31T12:20:00+02:00";
const NO_ROUTE = { data: { planConnection: { routingErrors: [{ code: "NO_DIRECT_MODE_CONNECTION" }], edges: [] } } };

// Answers in turn with each of `answers`: a body, an HTTP status, or "hang" for a request that never returns.
function fakeDigitransit(...answers: (object | number | "hang")[]) {
  const asked: { variables: Record<string, unknown>; key: string | null }[] = [];
  const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    asked.push({
      variables: (JSON.parse(String(init?.body)) as { variables: Record<string, unknown> }).variables,
      key: new Headers(init?.headers).get("digitransit-subscription-key"),
    });
    const answer = answers[Math.min(asked.length - 1, answers.length - 1)]!;
    if (answer === "hang") {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    }
    return Promise.resolve(typeof answer === "number" ? new Response("nope", { status: answer }) : Response.json(answer));
  });
  return { fetchFn, asked };
}

describe("the Digitransit router", () => {
  it("plans with the key, from A to B at the time, up to three ways by any public transport", async () => {
    const { fetchFn, asked } = fakeDigitransit(transit);

    await digitransitRouter({ url: URL_, apiKey: "secret", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "transit", departAt });

    expect(fetchFn.mock.calls[0]![0]).toBe(URL_);
    expect(asked[0]).toMatchObject({
      key: "secret",
      variables: {
        o: { location: { coordinate: { latitude: 60.169, longitude: 24.9316 } } },
        d: { location: { coordinate: { latitude: 60.1986, longitude: 24.933 } } },
        t: departAt,
        first: 3,
        modes: { transit: { transit: expect.arrayContaining([{ mode: "BUS" }, { mode: "TRAM" }, { mode: "SUBWAY" }]) } },
      },
    });
  });

  it("asks for one direct route when walking or cycling", async () => {
    const { fetchFn, asked } = fakeDigitransit(bike);
    const router = digitransitRouter({ url: URL_, apiKey: "k", fetchFn });

    await router.plan({ from: KAMPPI, to: PASILA, mode: "bike", departAt });
    await router.plan({ from: KAMPPI, to: PASILA, mode: "walk", departAt });

    expect(asked.map((a) => [a.variables.modes, a.variables.first])).toEqual([
      [{ directOnly: true, direct: ["BICYCLE"] }, 1],
      [{ directOnly: true, direct: ["WALK"] }, 1],
    ]);
  });

  it("gives each itinerary's legs with their lines, stops, times and route lines", async () => {
    const { fetchFn } = fakeDigitransit(transit);

    const itineraries = await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "transit", departAt });

    expect(itineraries).toHaveLength(3);
    expect(itineraries[0]).toMatchObject({ start: "2026-10-31T12:22:52+02:00", end: "2026-10-31T12:38:50+02:00", durationS: 958 });
    expect(itineraries[0]!.legs.map((l) => l.mode)).toEqual(["walk", "subway", "walk", "rail", "walk"]);
    const tram = itineraries[2]!.legs[1]!;
    expect(tram).toMatchObject({
      mode: "tram",
      line: { id: "HSL:1005T", name: "5T" },
      from: { stop: "HSL:1040408" },
      to: { stop: "HSL:1020453" },
      stops: ["HSL:1040408", "HSL:1040410", "HSL:1020453"],
      // The real-time estimate when there is one.
      start: "2026-10-31T12:26:03+02:00",
      end: "2026-10-31T12:28:53+02:00",
    });
    const [lon, lat] = itineraries[0]!.legs[0]!.geometry.coordinates[0]!;
    expect(lon).toBeCloseTo(KAMPPI.lon, 3);
    expect(lat).toBeCloseTo(KAMPPI.lat, 3);
    expect(itineraries[0]!.legs[0]!.stops).toEqual([]);
  });

  it("maps a bike route to one bike leg", async () => {
    const { fetchFn } = fakeDigitransit(bike);

    const [route] = await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "bike", departAt });

    expect(route).toMatchObject({ durationS: 1333, legs: [{ mode: "bike", from: { name: "Origin", lat: 60.169, lon: 24.9316 } }] });
    expect(route!.legs[0]!.line).toBeUndefined();
  });

  it("asks again once when told there's no route, as Digitransit sometimes says so wrongly", async () => {
    const { fetchFn, asked } = fakeDigitransit(NO_ROUTE, bike);

    const routes = await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "bike", departAt });

    expect(asked).toHaveLength(2);
    expect(routes).toHaveLength(1);
  });

  it("gives no route when the second answer agrees", async () => {
    const { fetchFn, asked } = fakeDigitransit(NO_ROUTE);

    const routes = await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "walk", departAt });

    expect(asked).toHaveLength(2);
    expect(routes).toEqual([]);
  });

  it("retries a failed or hung request once, then fails", async () => {
    const failing = fakeDigitransit(503, bike);
    const hanging = fakeDigitransit("hang");
    const trip = { from: KAMPPI, to: PASILA, mode: "bike" as const, departAt };

    expect(await digitransitRouter({ url: URL_, apiKey: "k", fetchFn: failing.fetchFn }).plan(trip)).toHaveLength(1);
    await expect(digitransitRouter({ url: URL_, apiKey: "k", fetchFn: hanging.fetchFn, timeoutMs: 10 }).plan(trip)).rejects.toThrow();
    expect(hanging.asked).toHaveLength(2);
  });
});
