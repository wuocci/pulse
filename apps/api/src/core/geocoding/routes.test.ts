import type { GeocodeResult } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import type { GeocodeSearch, Geocoder } from "../adapters/digitransit-geocoding.ts";
import { InMemoryEventStore } from "../events/store.ts";
import { type Region, regions } from "../regions/index.ts";

const KAMPPI: GeocodeResult = { name: "Kamppi", label: "Kamppi, Kampinkuja 1, Helsinki", lat: 60.169048, lon: 24.931662 };

function fakeGeocoder({ fail = false } = {}) {
  const asked: { text: string; search: GeocodeSearch }[] = [];
  const geocoder: Geocoder = {
    async search(text, search) {
      asked.push({ text, search });
      if (fail) throw new Error("Digitransit geocoding responded 503");
      return [KAMPPI];
    },
  };
  return { geocoder, asked };
}

function appWith(geocoderFor?: (region: Region) => Geocoder | undefined) {
  return createApp({ db: { ping: async () => true }, events: new InMemoryEventStore(), regions, ...(geocoderFor ? { geocoderFor } : {}) });
}

const get = (app: ReturnType<typeof createApp>, query: string) => app.request(`/v0/geocode?${query}`);

describe("GET /v0/geocode", () => {
  it("searches the Region at the point, near it, in the Region's main language", async () => {
    const { geocoder, asked } = fakeGeocoder();
    const asks: string[] = [];
    const app = appWith((region) => (asks.push(region.id), geocoder));

    const res = await get(app, "text=kampp&near=60.17,24.93");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [KAMPPI] });
    expect(asks).toEqual(["fi-capital-region"]);
    expect(asked).toEqual([{ text: "kampp", search: { focus: { lat: 60.17, lon: 24.93 }, bbox: [24.4, 60.0, 25.3, 60.45], lang: "fi" } }]);
  });

  it("answers in the reader's language when the Region speaks it", async () => {
    const { geocoder, asked } = fakeGeocoder();
    const app = appWith(() => geocoder);

    await get(app, "text=kampp&near=60.17,24.93&lang=sv");
    await get(app, "text=kampp&near=60.17,24.93&lang=de");

    expect(asked.map((a) => a.search.lang)).toEqual(["sv", "fi"]);
  });

  it("finds nothing outside every Region, without asking", async () => {
    const { geocoder, asked } = fakeGeocoder();

    const res = await get(appWith(() => geocoder), "text=kampp&near=48.85,2.35");

    expect(await res.json()).toEqual({ results: [] });
    expect(asked).toEqual([]);
  });

  it("says address search is off when the Region has no geocoder", async () => {
    expect((await get(appWith(), "text=kampp&near=60.17,24.93")).status).toBe(503);
  });

  it("says so when the geocoder fails", async () => {
    const { geocoder } = fakeGeocoder({ fail: true });

    expect((await get(appWith(() => geocoder), "text=kampp&near=60.17,24.93")).status).toBe(502);
  });

  it("needs some text and a point", async () => {
    const app = appWith(() => fakeGeocoder().geocoder);

    expect((await get(app, "text=k&near=60.17,24.93")).status).toBe(400);
    expect((await get(app, "text=kampp")).status).toBe(400);
  });
});
