import { describe, expect, it, vi } from "vitest";
import pasila from "./fixtures/street-parking/pasila.json" with { type: "json" };
import { helsinkiStreetParking, type StreetParkingSource, type StreetSpot, withFiller } from "./street-parking.ts";

const URL_ = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
const LAYER = "avoindata:Pysakointipaikat_alue";
const ZONES = "avoindata:Pysakoinnin_maksuvyohykkeet_alue";
const PASILA = { lat: 60.1986, lon: 24.933 };

// A fee zone around Pasila, with the city's wording of its price.
const zone = (nimi: string, price: string, [lon0, lat0, lon1, lat1]: number[]) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]] },
  properties: { nimi, lisatiedot: `Maksuvyöhykkeen sisällä pysäköinti maksaa ${price} tunnilta. Huomioithan, että vyöhykkeiden rajat eivät ole sijaintitarkkoja.` },
});
const NO_ZONES = { features: [] };

// Answers the spots query with `spots`, the zones query with `zones`.
function fakeWfs(spots: object = pasila, zones: object = NO_ZONES) {
  return vi.fn(async (url: string | URL | Request) => Response.json(new URL(String(url)).searchParams.get("typeNames") === ZONES ? zones : spots));
}
const source = (fetchFn: ReturnType<typeof fakeWfs>) => helsinkiStreetParking({ url: URL_, layer: LAYER, zonesLayer: ZONES, fetchFn });

const area = (properties: Record<string, unknown>, at = PASILA) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[at.lon, at.lat], [at.lon + 0.0001, at.lat], [at.lon + 0.0001, at.lat + 0.0001], [at.lon, at.lat]]] },
  properties: { luokka: null, tyyppi: "", kesto: "", voimassaolo: "", paikat_ala: 4, paikat_des: 4, ...properties },
});

describe("Helsinki's street parking", () => {
  it("asks the city's map service for the parking areas around a place", async () => {
    const fetchFn = fakeWfs();

    await source(fetchFn).around(PASILA);

    const url = new URL(String(fetchFn.mock.calls.find(([u]) => String(u).includes(LAYER.replace(":", "%3A")))![0]));
    expect(url.searchParams.get("srsName")).toBe("EPSG:4326");
    const [minLat, minLon, maxLat, maxLon] = url.searchParams.get("bbox")!.split(",").map(Number);
    expect(minLat).toBeLessThan(PASILA.lat);
    expect(maxLat).toBeGreaterThan(PASILA.lat);
    expect(minLon).toBeLessThan(PASILA.lon);
    expect(maxLon).toBeGreaterThan(PASILA.lon);
  });

  it("gives each spot's centre, spaces and distance, within the radius", async () => {
    const spots = await source(fakeWfs()).around(PASILA, 300);

    expect(spots.reduce((sum, s) => sum + s.spaces, 0)).toBe(19);
    for (const spot of spots) {
      expect(spot.distanceM).toBeLessThanOrEqual(300);
      expect(Math.abs(spot.lat - PASILA.lat)).toBeLessThan(0.003);
    }
  });

  it("reads who may park and for how long from the city's classes", async () => {
    const body = {
      features: [
        area({ luokka: 1, kesto: "2 h" }),
        area({ luokka: 2 }),
        area({ luokka: 4 }),
        area({ luokka: 5, kesto: "4h", voimassaolo: "9-21, (9-18)" }),
        area({ luokka: 8, voimassaolo: "8-20" }),
        area({ luokka: 9, voimassaolo: "7-18, (9-15)" }),
        area({ luokka: 6, kesto: "60 min", voimassaolo: "9-21, (9-18), 10-16" }),
      ],
    };

    const spots = await source(fakeWfs(body)).around(PASILA);

    expect(spots.map(({ kind, maxStayMin, disc, paidHours, noParkingHours }) => ({ kind, maxStayMin, disc, paidHours, noParkingHours }))).toEqual([
      { kind: "free", maxStayMin: 120, disc: false, paidHours: undefined, noParkingHours: undefined },
      { kind: "free", maxStayMin: undefined, disc: false, paidHours: undefined, noParkingHours: undefined },
      { kind: "paid", maxStayMin: 120, disc: false, paidHours: undefined, noParkingHours: undefined },
      { kind: "paid", maxStayMin: 240, disc: false, paidHours: { weekdays: [540, 1260], sat: [540, 1080] }, noParkingHours: undefined },
      { kind: "free", maxStayMin: undefined, disc: true, paidHours: undefined, noParkingHours: undefined },
      { kind: "free", maxStayMin: undefined, disc: false, paidHours: undefined, noParkingHours: { weekdays: [420, 1080], sat: [540, 900] } },
      { kind: "paid", maxStayMin: 60, disc: false, paidHours: { weekdays: [540, 1260], sat: [540, 1080], sun: [600, 960] }, noParkingHours: undefined },
    ]);
  });

  it("keeps electric-car and accessible spots apart, and leaves out the rest of the special ones", async () => {
    const body = {
      features: ["Taxi", "Poliisi", "Sähköpotkulauta", "Kuormauspaikka", "CD", "Pysäköintikielto", "Sähköauto", "Inva"].map((tyyppi) => area({ luokka: 0, tyyppi })),
    };

    const spots = await source(fakeWfs(body)).around(PASILA);

    expect(spots.map((s) => [s.kind, s.type])).toEqual([
      ["other", "ev"],
      ["other", "accessible"],
    ]);
  });

  it("prices a paid spot by the fee zone it's in", async () => {
    const zones = { features: [zone("Maksuvyöhyke 1", "4 euroa", [24.9, 60.19, 24.932, 60.21]), zone("Maksuvyöhyke 2", "2 euroa", [24.932, 60.19, 24.96, 60.21])] };
    const west = { lat: PASILA.lat, lon: 24.931 };
    const body = { features: [area({ luokka: 6 }, west), area({ luokka: 10 }), area({ luokka: 1 })] };

    const spots = await source(fakeWfs(body, zones)).around(PASILA);

    expect(spots.map((s) => [s.kind, s.zone, s.perHour])).toEqual([
      ["paid", "Maksuvyöhyke 1", 4],
      ["paid", "Maksuvyöhyke 2", 2],
      ["free", undefined, undefined],
    ]);
  });

  it("asks for the fee zones once", async () => {
    const fetchFn = fakeWfs();
    const parking = source(fetchFn);

    await parking.around(PASILA);
    await parking.around(PASILA);

    expect(fetchFn.mock.calls.filter(([u]) => String(u).includes("maksuvyohykkeet"))).toHaveLength(1);
  });

  it("still gives the spots when the zones can't be had", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("maksuvyohykkeet") ? new Response("down", { status: 503 }) : Response.json(pasila),
    );

    expect(await helsinkiStreetParking({ url: URL_, layer: LAYER, zonesLayer: ZONES, fetchFn }).around(PASILA)).not.toHaveLength(0);
  });
});

describe("the city's street parking, filled in from another Source", () => {
  const at = (northM: number, patch: Partial<StreetSpot> = {}): StreetSpot => ({ lat: PASILA.lat + northM / 111_320, lon: PASILA.lon, distanceM: northM, spaces: 4, kind: "free", disc: false, ...patch });
  const fixed = (spots: StreetSpot[]): StreetParkingSource => ({ around: async () => spots });
  const failing: StreetParkingSource = { around: async () => Promise.reject(new Error("down")) };

  it("keeps the city's spots, and adds the filler's only where the city has none nearby", async () => {
    const spots = await withFiller(fixed([at(0)]), fixed([at(30, { estimated: true }), at(200, { estimated: true })])).around(PASILA);

    expect(spots.map((s) => [s.distanceM, s.estimated ?? false])).toEqual([
      [0, false],
      [200, true],
    ]);
  });

  it("gives one's spots when the other fails, and fails only when both do", async () => {
    expect(await withFiller(failing, fixed([at(10)])).around(PASILA)).toHaveLength(1);
    expect(await withFiller(fixed([at(10)]), failing).around(PASILA)).toHaveLength(1);
    await expect(withFiller(failing, failing).around(PASILA)).rejects.toThrow("down");
  });
});
