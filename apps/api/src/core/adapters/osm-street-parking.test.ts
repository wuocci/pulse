import { describe, expect, it, vi } from "vitest";
import puusepankatu from "./fixtures/osm-street-parking/puusepankatu.json" with { type: "json" };
import { osmStreetParking, ruleOf, weekHours } from "./osm-street-parking.ts";

const URL_ = "https://overpass-api.de/api/interpreter";
const CREDIT = "© OpenStreetMap contributors (ODbL)";
// Puusepänkatu 4, Helsinki: free parking along the street, 10 h with a disc on weekdays.
const PUUSEPANKATU_4 = { lat: 60.19525, lon: 25.04157 };

function fakeOverpass(body: object = puusepankatu) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(body));
}
const source = (fetchFn: ReturnType<typeof fakeOverpass>, now = () => 0) => osmStreetParking({ url: URL_, credit: CREDIT, fetchFn, now });

const way = (id: number, tags: Record<string, string>, lengthM = 110) => ({
  type: "way",
  id,
  tags: { highway: "residential", ...tags },
  geometry: [PUUSEPANKATU_4, { lat: PUUSEPANKATU_4.lat + lengthM / 111_320, lon: PUUSEPANKATU_4.lon }],
});

describe("Street parking from OpenStreetMap", () => {
  it("finds the 10 h disc parking on Puusepänkatu, where the city's data has none", async () => {
    const spots = await source(fakeOverpass()).around(PUUSEPANKATU_4, 300);

    const disc10h = spots.filter((s) => s.disc && s.maxStayMin === 600);
    expect(disc10h.length).toBeGreaterThan(0);
    for (const spot of disc10h) {
      expect(spot).toMatchObject({ kind: "free", estimated: true, credit: CREDIT });
      expect(spot.distanceM).toBeLessThanOrEqual(300);
    }
    // Insinöörinkatu's 2 h disc parking is a few streets away.
    expect(spots.some((s) => s.disc && s.maxStayMin === 120)).toBe(false);
    expect((await source(fakeOverpass()).around(PUUSEPANKATU_4, 500)).some((s) => s.disc && s.maxStayMin === 120)).toBe(true);
  });

  it("asks Overpass per tile once, and again only after a week", async () => {
    const fetchFn = fakeOverpass();
    let now = 0;
    const osm = source(fetchFn, () => now);

    await osm.around(PUUSEPANKATU_4, 300);
    const asked = fetchFn.mock.calls.length;
    expect(asked).toBeGreaterThan(0);
    await osm.around({ lat: PUUSEPANKATU_4.lat + 0.0005, lon: PUUSEPANKATU_4.lon }, 300);
    expect(fetchFn.mock.calls.length).toBe(asked);

    now = 8 * 86_400_000;
    await osm.around(PUUSEPANKATU_4, 300);
    expect(fetchFn.mock.calls.length).toBe(2 * asked);
  });

  it("asks again after a failure instead of keeping it", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("busy", { status: 429 }));
    const osm = source(fetchFn);

    await expect(osm.around(PUUSEPANKATU_4, 300)).rejects.toThrow("429");
    const asked = fetchFn.mock.calls.length;
    await expect(osm.around(PUUSEPANKATU_4, 300)).rejects.toThrow();
    expect(fetchFn.mock.calls.length).toBe(2 * asked);
  });

  it("works out spaces from the street's length, both sides alike as one spot", async () => {
    const spots = await source(fakeOverpass({ elements: [way(1, { "parking:both": "lane", "parking:both:orientation": "parallel" }, 90)] })).around(PUUSEPANKATU_4, 300);

    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ spaces: 2 * Math.floor((90 * 0.7) / 5.5), estimated: true, kind: "free" });
  });

  it("cuts a long street into pieces, keeping only those within the radius", async () => {
    const spots = await source(fakeOverpass({ elements: [way(1, { "parking:right": "yes" }, 1000)] })).around(PUUSEPANKATU_4, 300);

    expect(spots.length).toBe(3);
    expect(Math.max(...spots.map((s) => s.distanceM))).toBeLessThanOrEqual(300);
  });
});

describe("Reading one side's parking", () => {
  it("reads the newer tags, per side or for both", () => {
    expect(ruleOf({ "parking:both": "lane", "parking:both:orientation": "diagonal" }, "left")).toEqual({ orientation: "diagonal", kind: "free", disc: false });
    expect(ruleOf({ "parking:left": "yes", "parking:right": "no" }, "right")).toBeUndefined();
    expect(ruleOf({ "parking:left": "lane", "parking:left:fee": "yes" }, "left")).toMatchObject({ kind: "paid" });
    expect(ruleOf({ "parking:left": "lane", "parking:left:maxstay": "2 h", "parking:left:authentication:disc": "yes" }, "left")).toMatchObject({ disc: true, maxStayMin: 120 });
  });

  it("reads the older parking:lane and parking:condition tags", () => {
    expect(ruleOf({ "parking:lane:both": "parallel", "parking:condition:both": "disc", "parking:condition:both:maxstay": "10 h" }, "left")).toEqual({
      orientation: "parallel",
      kind: "free",
      disc: true,
      maxStayMin: 600,
    });
    expect(ruleOf({ "parking:lane:both": "perpendicular", "parking:condition:both": "ticket", "parking:condition:both:time_interval": "Mo-Fr 08:00-18:00" }, "right")).toEqual({
      orientation: "perpendicular",
      kind: "paid",
      disc: false,
      paidHours: { weekdays: [480, 1080] },
    });
  });

  it("leaves out no parking, no stopping, and residents' or customers' parking", () => {
    expect(ruleOf({ "parking:lane:both": "no_stopping" }, "left")).toBeUndefined();
    expect(ruleOf({ "parking:both": "no", "parking:both:restriction": "no_parking" }, "left")).toBeUndefined();
    expect(ruleOf({ "parking:lane:both": "parallel", "parking:condition:both": "residents" }, "left")).toBeUndefined();
    expect(ruleOf({ "parking:both": "lane", "parking:both:access": "customers" }, "left")).toBeUndefined();
  });

  it("reads the common opening hours forms, and nothing else", () => {
    expect(weekHours("Mo-Sa 07:00-21:00")).toEqual({ weekdays: [420, 1260], sat: [420, 1260] });
    expect(weekHours("Mo-Fr 08:00-18:00; Sa 09:00-15:00")).toEqual({ weekdays: [480, 1080], sat: [540, 900] });
    expect(weekHours("Mo-Fr 08:00-18:00; PH off")).toBeUndefined();
  });
});
