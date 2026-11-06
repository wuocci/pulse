import { describe, expect, it, vi } from "vitest";
import { digitransitRouter } from "./digitransit-routing.ts";
import bike from "./fixtures/digitransit-routing/bike.json" with { type: "json" };
import parkride from "./fixtures/digitransit-routing/parkride.json" with { type: "json" };
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

  it("asks for one direct route when walking, cycling or driving", async () => {
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

  it("plans a car trip both ways: driving all the way, and parking at a park-and-ride for public transport", async () => {
    const { fetchFn, asked } = fakeDigitransit(bike, parkride);

    await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "car", departAt });

    expect(asked.map((a) => [a.variables.modes, a.variables.first])).toEqual([
      [{ directOnly: true, direct: ["CAR"] }, 1],
      [{ transit: { access: ["CAR_PARKING"], transit: expect.arrayContaining([{ mode: "SUBWAY" }]) } }, 2],
    ]);
  });

  describe("park-and-ride ways", () => {
    // Recorded from Matinkylä to Kamppi: parking at Niittykumpu, arriving 18:17 and 18:22.
    const ESPOO = { lat: 60.1395, lon: 24.643 };
    const carTrip = (to = KAMPPI) => ({ from: ESPOO, to, mode: "car" as const, departAt });
    const carLeg = parkride.data.planConnection.edges[0]!.node.legs[0]!;
    const driveUntil = (end: string) => ({
      data: { planConnection: { routingErrors: [], edges: [{ node: { start: carLeg.start.scheduledTime, end, duration: 1500, legs: [{ ...carLeg, to: { ...carLeg.to, vehicleParking: null }, end: { scheduledTime: end, estimated: null } }] } }] } },
    });
    const plan = (...answers: object[]) => digitransitRouter({ url: URL_, apiKey: "k", fetchFn: fakeDigitransit(...answers).fetchFn }).plan(carTrip());

    it("gives the drive first, then the park-and-ride ways, naming where to park", async () => {
      const ways = await plan(driveUntil("2026-11-01T18:15:00+02:00"), parkride);

      expect(ways.map((w) => w.legs.map((l) => l.mode))).toEqual([
        ["car"],
        ["car", "walk", "subway", "walk"],
        ["car", "walk", "bus", "walk", "subway", "walk"],
      ]);
      expect(ways[1]!.legs[0]!.to).toMatchObject({ parking: "Niittykumpu" });
    });

    it("tells how many cars the car park takes, when Digitransit knows", async () => {
      const edges = parkride.data.planConnection.edges.map(({ node }) => ({
        node: { ...node, legs: [{ ...node.legs[0]!, to: { ...node.legs[0]!.to, vehicleParking: { name: "Niittykumpu", capacity: { carSpaces: 340 } } } }, ...node.legs.slice(1)] },
      }));

      const ways = await plan(driveUntil("2026-11-01T18:15:00+02:00"), { data: { planConnection: { routingErrors: [], edges } } });

      expect(ways[1]!.legs[0]!.to).toMatchObject({ parking: "Niittykumpu", parkingSpaces: 340 });
    });

    it("tells how many spaces are free, as the plan is answered, where the car park reports it live", async () => {
      const at = (vehicleParking: object) =>
        parkride.data.planConnection.edges.map(({ node }) => ({
          node: { ...node, legs: [{ ...node.legs[0]!, to: { ...node.legs[0]!.to, vehicleParking } }, ...node.legs.slice(1)] },
        }));
      const now = new Date("2026-11-01T17:50:00Z");
      const planWith = (vehicleParking: object) =>
        digitransitRouter({
          url: URL_,
          apiKey: "k",
          clock: () => now,
          fetchFn: fakeDigitransit(driveUntil("2026-11-01T18:15:00+02:00"), { data: { planConnection: { routingErrors: [], edges: at(vehicleParking) } } }).fetchFn,
        }).plan(carTrip());

      const live = await planWith({ name: "Niittykumpu", capacity: { carSpaces: 100 }, realtime: true, availability: { carSpaces: 6 } });
      expect(live[1]!.legs[0]!.to.parkingFree).toEqual({ spaces: 6, readAt: now.toISOString(), almostFull: true });

      // Not live: a count from a static source isn't what's free now.
      const statics = await planWith({ name: "Niittykumpu", capacity: { carSpaces: 100 }, realtime: false, availability: { carSpaces: 100 } });
      expect(statics[1]!.legs[0]!.to).not.toHaveProperty("parkingFree");
    });

    it("leaves out a way that doesn't drive: Digitransit adds walking all the way", async () => {
      const walkOnly = transit.data.planConnection.edges[0]!;
      const answer = { data: { planConnection: { routingErrors: [], edges: [walkOnly, ...parkride.data.planConnection.edges] } } };

      const ways = await plan(driveUntil("2026-11-01T18:15:00+02:00"), answer);

      expect(ways.map((w) => w.legs[0]!.mode)).toEqual(["car", "car", "car"]);
    });
  });

  it("tells each leg's length along its line", async () => {
    const { fetchFn } = fakeDigitransit(bike);

    const [route] = await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "bike", departAt });

    // Kamppi to Pasila is 3.3 km as the crow flies.
    expect(route!.legs[0]!.distanceM).toBeGreaterThan(3300);
    expect(route!.legs[0]!.distanceM).toBeLessThan(6000);
  });

  it("still gives the drive when the park-and-ride plan fails", async () => {
    const node = bike.data.planConnection.edges[0]!.node;
    const drive = { data: { planConnection: { routingErrors: [], edges: [{ node: { ...node, legs: [{ ...node.legs[0]!, mode: "CAR" }] } }] } } };
    const { fetchFn } = fakeDigitransit(drive, 503, 503);

    const ways = await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "car", departAt });

    expect(ways).toHaveLength(1);
  });

  it("maps a car route to one car leg", async () => {
    const node = bike.data.planConnection.edges[0]!.node;
    const car = { data: { planConnection: { routingErrors: [], edges: [{ node: { ...node, legs: [{ ...node.legs[0]!, mode: "CAR" }] } }] } } };
    const { fetchFn } = fakeDigitransit(car);

    const [route] = await digitransitRouter({ url: URL_, apiKey: "k", fetchFn }).plan({ from: KAMPPI, to: PASILA, mode: "car", departAt });

    expect(route!.legs.map((l) => l.mode)).toEqual(["car"]);
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
