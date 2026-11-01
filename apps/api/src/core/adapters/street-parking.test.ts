import { describe, expect, it, vi } from "vitest";
import pasila from "./fixtures/street-parking/pasila.json" with { type: "json" };
import { helsinkiStreetParking } from "./street-parking.ts";

const URL_ = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
const LAYER = "avoindata:Pysakointipaikat_alue";
const PASILA = { lat: 60.1986, lon: 24.933 };

function fakeWfs(body: object = pasila) {
  const fetchFn = vi.fn(async (_url: string | URL | Request) => Response.json(body));
  return fetchFn;
}

describe("Helsinki's street parking", () => {
  it("asks the city's map service for the parking areas around a place", async () => {
    const fetchFn = fakeWfs();

    await helsinkiStreetParking({ url: URL_, layer: LAYER, fetchFn }).around(PASILA);

    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.searchParams.get("typeNames")).toBe(LAYER);
    expect(url.searchParams.get("srsName")).toBe("EPSG:4326");
    const [minLat, minLon, maxLat, maxLon] = url.searchParams.get("bbox")!.split(",").map(Number);
    expect(minLat).toBeLessThan(PASILA.lat);
    expect(maxLat).toBeGreaterThan(PASILA.lat);
    expect(minLon).toBeLessThan(PASILA.lon);
    expect(maxLon).toBeGreaterThan(PASILA.lon);
  });

  it("sums the spaces within 300 m: how many are paid, free, for electric cars or accessible", async () => {
    const parking = await helsinkiStreetParking({ url: URL_, layer: LAYER, fetchFn: fakeWfs() }).around(PASILA);

    expect(parking).toEqual({ spaces: 19, paid: 15, free: 4, ev: 0, accessible: 0, radiusM: 300 });
  });

  it("leaves out taxi, police and scooter spots, and counts electric-car and accessible ones", async () => {
    const area = (tyyppi: string, luokka: number | null, paikat_ala: number) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[24.933, 60.1986], [24.9331, 60.1986], [24.9331, 60.1987], [24.933, 60.1986]]] },
      properties: { luokka, tyyppi, paikat_ala, paikat_des: paikat_ala },
    });
    const body = { features: [area("Taxi", 0, 3), area("Poliisi", 0, 2), area("Sähköpotkulauta", null, 10), area("Sähköauto", 0, 2), area("Inva", 0, 1), area("", 5, 6)] };

    const parking = await helsinkiStreetParking({ url: URL_, layer: LAYER, fetchFn: fakeWfs(body) }).around(PASILA);

    expect(parking).toEqual({ spaces: 9, paid: 6, free: 0, ev: 2, accessible: 1, radiusM: 300 });
  });

  it("says nothing when there's no street parking near", async () => {
    expect(await helsinkiStreetParking({ url: URL_, layer: LAYER, fetchFn: fakeWfs({ features: [] }) }).around(PASILA)).toBeUndefined();
  });
});
