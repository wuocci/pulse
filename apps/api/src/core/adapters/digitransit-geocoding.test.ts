import { describe, expect, it, vi } from "vitest";
import { digitransitGeocoder } from "./digitransit-geocoding.ts";
import kampp from "./fixtures/digitransit-geocoding/kampp.json" with { type: "json" };

const URL_ = "https://api.digitransit.fi/geocoding/v1";
const search = { focus: { lat: 60.17, lon: 24.93 }, bbox: [24.4, 60.0, 25.3, 60.45] as const, lang: "fi" };

function fakeGeocoding({ status = 200 } = {}) {
  const asked: { url: URL; key: string | null }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: new URL(String(url)), key: new Headers(init?.headers).get("digitransit-subscription-key") });
    return status === 200 ? Response.json(kampp) : new Response("nope", { status });
  });
  return { fetchFn, asked };
}

describe("the Digitransit geocoder", () => {
  it("asks autocomplete with the key, near the point, inside the Region, in the reader's language", async () => {
    const { fetchFn, asked } = fakeGeocoding();

    await digitransitGeocoder({ url: URL_, apiKey: "secret", fetchFn }).search("kampp", search);

    const [{ url, key }] = asked as [(typeof asked)[number]];
    expect(`${url.origin}${url.pathname}`).toBe(`${URL_}/autocomplete`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      text: "kampp",
      lang: "fi",
      "focus.point.lat": "60.17",
      "focus.point.lon": "24.93",
      "boundary.rect.min_lon": "24.4",
      "boundary.rect.min_lat": "60",
      "boundary.rect.max_lon": "25.3",
      "boundary.rect.max_lat": "60.45",
    });
    expect(key).toBe("secret");
  });

  it("gives at most five places", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [24.9, 60.1] },
      properties: { name: `Street ${i}`, label: `Street ${i}, Helsinki` },
    }));
    const fetchFn = vi.fn(async () => Response.json({ type: "FeatureCollection", features: many }));

    expect(await digitransitGeocoder({ url: URL_, apiKey: "k", fetchFn }).search("street", search)).toHaveLength(5);
  });

  it("gives each place once, by its label", async () => {
    const { fetchFn } = fakeGeocoding();

    const results = await digitransitGeocoder({ url: URL_, apiKey: "k", fetchFn }).search("kampp", search);

    expect(results[0]).toEqual({ name: "Kamppi", label: "Kamppi, Kampinkuja 1, Helsinki", lat: 60.169048, lon: 24.931662 });
    expect(results.map((r) => r.label)).toEqual([
      "Kamppi, Kampinkuja 1, Helsinki",
      "Kamppi (M), Kamppi, Helsinki",
      "Kamppi, Helsinki",
      "Kamppi (bussipysäkki), Kamppi, Helsinki",
    ]);
  });

  it("fails when Digitransit does", async () => {
    const { fetchFn } = fakeGeocoding({ status: 503 });

    await expect(digitransitGeocoder({ url: URL_, apiKey: "k", fetchFn }).search("kampp", search)).rejects.toThrow("503");
  });
});
