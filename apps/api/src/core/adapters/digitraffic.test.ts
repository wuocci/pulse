import { EventSchema } from "@pulse/schema";
import { describe, expect, it, vi } from "vitest";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import type { DigitrafficSource } from "../regions/index.ts";
import { fetchMessages, type MessageCollection, toEvents } from "./digitraffic.ts";
import fixture from "./fixtures/digitraffic/messages.json" with { type: "json" };

const source = fiCapitalRegion.sources.find((s): s is DigitrafficSource => s.adapter === "digitraffic")!;
const now = new Date("2026-10-31T12:00:00Z");
const messages = fixture as MessageCollection;
const events = toEvents(messages, { source, region: fiCapitalRegion, now });
const byId = Object.fromEntries(events.map((e) => [e.sources[0]!.id, e]));

const KEHA_I = "GUID50472972";
const TEOLLISUUSKATU = "GUID50472939";
const LAHDENVAYLA = "GUID50472949";
const TUUSULA = "GUID50472176";
const SATAMATIE = "GUID50459844";

describe("Digitraffic road messages → Events", () => {
  it("turns every roadworks message and traffic notice into a valid Event", () => {
    expect(events).toHaveLength(5);
    for (const event of events) expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("maps roadworks on a road section, with the hours the work is on", () => {
    expect(byId[KEHA_I]).toMatchObject({
      id: `${source.id}:${KEHA_I}`,
      kind: "works",
      layers: ["area", "trips"],
      title: { en: "Roadworks · Kehä I · Pukinmäen liittymä", fi: "Tietyö · Kehä I · Pukinmäen liittymä" },
      where: { precision: "segment", geometry: { type: "MultiLineString" } },
      when: { start: "2026-11-01T22:00:00Z", end: "2026-11-04T21:59:59.999Z", dailyHours: { from: "22:00", to: "06:00", days: ["mon", "tue", "wed"] } },
      mainlyAffected: "drivers",
      status: "upcoming",
      sources: [{ name: source.publisher, id: KEHA_I, license: source.license }],
      confidence: 1,
    });
    expect(byId[KEHA_I]!.originalText?.fi).toMatch(/^Tie 101, eli Kehä I, Helsinki\./);
  });

  it("rates roadworks by what they close: the road → major, lanes → consider, only slower → minor", () => {
    expect(byId[TEOLLISUUSKATU]).toMatchObject({ severity: "major", noticeable: ["blocked"], where: { precision: "exact" } });
    expect(byId[KEHA_I]).toMatchObject({ severity: "consider", noticeable: ["blocked"] });
    expect(byId[LAHDENVAYLA]).toMatchObject({ severity: "minor", noticeable: [], when: { dailyHours: { from: "07:00", to: "18:00", days: ["mon", "tue", "wed", "thu"] } } });
  });

  it("doesn't call it a closed road when one carriageway is closed and traffic goes on the other, or the road closes now and then", () => {
    const feature = messages.features.find((f) => f.properties.situationId === TEOLLISUUSKATU)!;
    const withRestriction = (type: string) => {
      const announcement = feature.properties.announcements[0]!;
      const phases = announcement.roadWorkPhases!.map((phase) => ({ ...phase, restrictions: [{ type, restriction: { name: type } }] }));
      return { ...feature, properties: { ...feature.properties, announcements: [{ ...announcement, roadWorkPhases: phases }] } };
    };
    const severityWith = (type: string) => toEvents({ features: [withRestriction(type)] }, { source, region: fiCapitalRegion, now })[0]!.severity;

    expect(severityWith("SINGLE_CARRIAGEWAY_CLOSED")).toBe("consider");
    expect(severityWith("INTERMITTENT_SHORT_TERM_CLOSURE")).toBe("consider");
    expect(severityWith("ROAD_CLOSED")).toBe("major");
    expect(severityWith("DETOUR")).toBe("major");
  });

  it("says a closed walking and cycling path is in everyone's way, not only drivers'", () => {
    expect(byId[TUUSULA]).toMatchObject({ mainlyAffected: "everyone", severity: "consider", noticeable: ["blocked"], status: "active" });
    expect(byId[TUUSULA]!.title.en).toBe("Roadworks · Tuusulan Itäväylä");
  });

  it("maps a traffic notice as a disruption you'd run into right now too", () => {
    expect(byId[SATAMATIE]).toMatchObject({
      kind: "disruption",
      layers: ["area", "trips", "now"],
      title: { en: "Traffic notice · Vuosaaren satamatie · Itäväylän liittymä", fi: "Liikennetiedote · Vuosaaren satamatie · Itäväylän liittymä" },
      severity: "major",
      noticeable: ["blocked"],
    });
  });

  it("gives no daily hours when the days have different ones", () => {
    const feature = messages.features.find((f) => f.properties.situationId === LAHDENVAYLA)!;
    const phase = feature.properties.announcements[0]!.roadWorkPhases![0]!;
    const uneven = { ...feature, properties: { ...feature.properties, announcements: [{ ...feature.properties.announcements[0]!, roadWorkPhases: [{ ...phase, workingHours: [...phase.workingHours!.slice(1), { weekday: "FRIDAY", startTime: "09:00:00", endTime: "12:00:00" }] }] }] } };

    expect(toEvents({ features: [uneven] }, { source, region: fiCapitalRegion, now })[0]!.when.dailyHours).toBeUndefined();
  });

  it("keeps only messages in the Region", () => {
    const [first] = messages.features;
    const elsewhere = { ...first!, properties: { ...first!.properties, situationId: "far" }, geometry: { type: "Point", coordinates: [27.7, 62.9] } };

    expect(toEvents({ features: [elsewhere] }, { source, region: fiCapitalRegion, now })).toEqual([]);
  });
});

describe("fetching Digitraffic", () => {
  it("asks for roadworks and traffic notices, saying who's asking as Digitraffic requires", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ type: "FeatureCollection", features: [] }));

    await fetchMessages(source, fetchFn);

    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.searchParams.getAll("situationType")).toEqual(["ROAD_WORK", "TRAFFIC_ANNOUNCEMENT"]);
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get("Digitraffic-User")).toBe("pulse");
  });
});
