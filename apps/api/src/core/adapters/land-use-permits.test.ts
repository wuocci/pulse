import { EventSchema } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { isPermitSource, type LandUsePermitSource } from "../regions/index.ts";
import excavations from "./fixtures/land-use-permits/excavations.json" with { type: "json" };
import outdoorEvents from "./fixtures/land-use-permits/outdoor-events.json" with { type: "json" };
import trafficArrangements from "./fixtures/land-use-permits/traffic-arrangements.json" with { type: "json" };
import { localTime, type PermitCollection, permitsUrl, toEvents } from "./land-use-permits.ts";

// Recorded from the permit system's WFS: excavations on 2026-10-23, the other layers on 2026-10-24.
const now = new Date("2026-10-24T12:00:00+03:00");
const contextFor = (permitType: LandUsePermitSource["permitType"]) => ({
  source: fiCapitalRegion.sources.filter(isPermitSource).find((s) => s.permitType === permitType)!,
  timeZone: fiCapitalRegion.timeZone,
  now,
});

const collection = excavations as PermitCollection;
const context = contextFor("excavation");
const { source } = context;

describe("excavation notices → Events", () => {
  const events = toEvents(collection, context);

  it("turns every notice into a valid Event", () => {
    expect(events).toHaveLength(4);
    for (const event of events) expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("maps a notice's fields, keeping the original text", () => {
    const event = events.find((e) => e.id === `${source.id}:KP2602791-2`)!;

    expect(event.kind).toBe("works");
    expect(event.severity).toBe("minor");
    expect(event.where.precision).toBe("area");
    expect(event.when).toEqual({ start: "2026-10-29T00:00:00+02:00", end: "2026-11-13T23:59:59+02:00" });
    expect(event.title).toEqual({
      en: "Excavation · Vilppulantie 26 · until 13 Nov",
      fi: "Kaivutyö · Vilppulantie 26 · 13.11. asti",
    });
    expect(event.originalText?.fi).toMatch(/^Sadevesiviemärin korjaus/);
    expect(event.sources[0]).toMatchObject({ name: source.publisher, id: "KP2602791-2", license: source.license });
  });

  it("marks digs as noise and a blocked street", () => {
    for (const event of events) expect(event.noticeable).toEqual(["noise", "blocked"]);
  });

  it("falls back to the district, then to nothing, when the notice has no address", () => {
    const [first] = collection.features;
    const title = (properties: object) =>
      toEvents({ features: [{ ...first!, properties: { ...first!.properties, ...properties } }] }, context)[0]!.title.en;

    expect(title({ osoite: null })).toBe("Excavation · Malmi · until 13 Nov");
    expect(title({ osoite: null, kaupunginosa: null })).toBe("Excavation · until 13 Nov");
  });

  it("derives status from the dates", () => {
    const status = Object.fromEntries(events.map((e) => [e.sources[0]!.id, e.status]));

    expect(status).toEqual({
      "KP2602791-2": "upcoming",
      KP2603015: "upcoming",
      KP2602966: "active",
      KP2603005: "active",
    });
  });

  it("merges the areas of one notice into a single Event", () => {
    const [first, second] = collection.features;
    const split: PermitCollection = {
      features: [first!, { ...second!, properties: { ...second!.properties, hakemustunnus: first!.properties.hakemustunnus } }],
    };
    const merged = toEvents(split, context);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.where.geometry.type).toBe("MultiPolygon");
    expect(merged[0]!.where.geometry.coordinates).toHaveLength(2);
  });

  it("keeps coordinates in GeoJSON order, longitude first", () => {
    const [lon, lat] = (events[0]!.where.geometry.coordinates as number[][][][])[0]![0]![0]!;

    expect(lon).toBeGreaterThan(24);
    expect(lat).toBeGreaterThan(60);
  });

  it("asks the WFS for the configured layer in WGS84", () => {
    const url = new URL(permitsUrl(source));

    expect(url.searchParams.get("typeName")).toBe(source.layer);
    expect(url.searchParams.get("srsName")).toBe("EPSG:4326");
  });
});

describe("temporary traffic arrangements → Events", () => {
  const events = toEvents(trafficArrangements as PermitCollection, contextFor("traffic-arrangement"));
  const byId = Object.fromEntries(events.map((e) => [e.sources[0]!.id, e]));

  it("turns every notice into a valid closure Event", () => {
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(EventSchema.safeParse(event).success).toBe(true);
      expect(event).toMatchObject({ kind: "closure", severity: "consider" });
    }
  });

  it("marks arrangements as a blocked street", () => {
    for (const event of events) expect(event.noticeable).toEqual(["blocked"]);
  });

  it("maps the arrangement's dates, title and purpose", () => {
    expect(byId.LJ2600093).toMatchObject({
      id: "hel-traffic-arrangements:LJ2600093",
      when: { start: "2026-12-13T00:00:00+02:00", end: "2026-12-13T23:59:59+02:00" },
      title: {
        en: "Traffic arrangement · Kirkkokatu · until 13 Dec",
        fi: "Liikennejärjestely · Kirkkokatu · 13.12. asti",
      },
      originalText: { fi: "Tilapäiset liikennejärjestelyt; yleisötilaisuus (Lucia-kulkue)" },
      status: "upcoming",
    });
  });

  it("marks an arrangement resolved from its dates even when the city still lists it as ongoing", () => {
    // The city's own status for LJ2600067 says Käynnissä (ongoing); it ended on 28 May.
    expect(byId.LJ2600067!.status).toBe("resolved");
  });
});

describe("outdoor events → Events", () => {
  const events = toEvents(outdoorEvents as PermitCollection, contextFor("outdoor-event"));
  const byId = Object.fromEntries(events.map((e) => [e.sources[0]!.id, e]));

  it("turns every event into a valid Public event, one per notice", () => {
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(EventSchema.safeParse(event).success).toBe(true);
      expect(event.kind).toBe("public_event");
    }
  });

  it("marks outdoor events as crowd and noise", () => {
    for (const event of events) expect(event.noticeable).toEqual(["crowd", "noise"]);
  });

  it("spans build-up to teardown, with the event's own dates in the title", () => {
    expect(byId.TP2500373).toMatchObject({
      when: { start: "2026-11-09T00:00:00+02:00", end: "2026-12-30T23:59:59+02:00" },
      title: {
        en: "Tuomaan markkinat 2026 · Senaatintori · 27 Nov – 22 Dec",
        fi: "Tuomaan markkinat 2026 · Senaatintori · 27.11.–22.12.",
      },
    });
    expect(byId.TP2500373!.where.geometry.coordinates).toHaveLength(2);
  });

  it("uses the event's dates when there is no build-up or teardown", () => {
    expect(byId.TP2601020).toMatchObject({
      when: { start: "2026-11-15T00:00:00+02:00", end: "2026-11-15T23:59:59+02:00" },
      title: { en: "Kurvin talkoot · Vaasanpuistikko · until 15 Nov" },
    });
  });

  it("names a promotion generically and places it by district when it has no address", () => {
    expect(byId.TP2600853!.title).toEqual({
      en: "Promotion · Kluuvi · until 15 Nov",
      fi: "Promootio · Kluuvi · 15.11. asti",
    });
  });
});

describe("localTime", () => {
  it("uses the zone's offset for that day, including summer time", () => {
    expect(localTime("2026-10-24", "00:00:00", "Europe/Helsinki")).toBe("2026-10-24T00:00:00+03:00");
    expect(localTime("2026-10-26", "00:00:00", "Europe/Helsinki")).toBe("2026-10-26T00:00:00+02:00");
    expect(localTime("2026-07-01", "12:00:00", "America/New_York")).toBe("2026-07-01T12:00:00-04:00");
  });
});
