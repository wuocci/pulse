import { readFileSync } from "node:fs";
import { EventSchema } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { eventRoutes } from "../events/routes.ts";
import { InMemoryEventStore } from "../events/store.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import type { CapSource } from "../regions/index.ts";
import { type CapAlert, fetchAlerts, readFeed, toEvents } from "./cap.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/cap/${name}`, import.meta.url), "utf8");
const source = fiCapitalRegion.sources.find((s): s is CapSource => s.adapter === "cap")!;
const region = fiCapitalRegion;

// FMI's live feed on 2026-11-02: three sea wind warnings, none reaching the capital region.
const live = readFeed(fixture("fmi-feed-2026-11-02.xml"));
// Archived FMI alerts, in the order they were sent: a slippery-road warning for Uusimaa and its first Update,
// the last Update of a sea wind warning on the Gulf of Finland and the Cancel that withdrew it,
// an orange slippery-road warning for the south and a slippery-pavement warning that covers Uusimaa.
const [roadAlert, roadUpdate, seaUpdate, seaCancel, orangeRoad, pavement] = readFeed(fixture("fmi-archive-2026.xml")).alerts as [
  CapAlert,
  CapAlert,
  CapAlert,
  CapAlert,
  CapAlert,
  CapAlert,
];
const DURING_FEB_WARNINGS = new Date("2026-02-26T16:00:00Z");

const DURING_ROAD_WARNING = new Date("2026-01-06T16:00:00Z"); // 18:00 in Helsinki, the warning is 17–24
const BEFORE_ROAD_WARNING = new Date("2026-01-05T02:00:00Z");

describe("CAP feed", () => {
  it("reads the alerts an Atom feed embeds, with every language's info", () => {
    expect(live.links).toEqual([]);
    expect(live.alerts).toHaveLength(3);
    expect(live.alerts[0]).toMatchObject({ msgType: "Update", status: "Actual", sender: "urn:oid:2.49.0.0.246.0" });
    expect(live.alerts[0]!.infos.map((i) => i.language)).toEqual(["fi-FI", "sv-FI", "en-GB"]);
    expect(live.alerts[0]!.infos[0]).toMatchObject({ severity: "Moderate", eventCodes: ["seaWind"] });
  });

  it("makes no Events of warnings outside the Region", () => {
    expect(toEvents(live.alerts, { source, region, now: new Date("2026-11-02T13:00:00Z") })).toEqual([]);
  });

  it("fetches the alerts a feed only links to", async () => {
    const roadXml = fixture("fmi-archive-2026.xml").match(/<alert[\s\S]*?<\/alert>/)![0];
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link type="application/cap+xml" href="https://cap.example/1.xml"/></entry></feed>`;
    const fetchFn = (async (url: string | URL) => new Response(String(url) === source.url ? feed : roadXml)) as typeof fetch;

    const alerts = await fetchAlerts(source, fetchFn);

    expect(alerts.map((a) => a.identifier)).toEqual([roadAlert.identifier]);
  });
});

describe("CAP alerts → weather Events", () => {
  it("maps a slippery-road warning onto its area and time window", () => {
    const [event] = toEvents([roadAlert], { source, region, now: BEFORE_ROAD_WARNING });

    expect(EventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      id: `fmi-warnings:${roadAlert.identifier}`,
      kind: "weather",
      layers: ["area", "trips"],
      title: { en: "Yellow traffic weather warning: Uusimaa, Tue 17.00 - Wed 0.00", fi: "Keltainen liikennesää: Uusimaa, ti 17.00 - ke 0.00" },
      where: { precision: "area", geometry: { type: "Polygon" } },
      when: { start: "2026-01-06T15:00:00.000Z", end: "2026-01-06T22:00:00.000Z" },
      severity: "consider",
      mainlyAffected: "drivers",
      noticeable: [],
      status: "upcoming",
      sources: [{ name: "Finnish Meteorological Institute", id: roadAlert.identifier, license: "CC BY 4.0", attribution: "Finnish Meteorological Institute, CC BY 4.0" }],
    });
    expect(event!.title.sv).toMatch(/^Gul trafikvädret: Nyland/);
    expect(event!.originalText?.en).toBeTruthy();
  });

  it("keeps lon,lat order and closes the ring", () => {
    const [event] = toEvents([roadAlert], { source, region, now: BEFORE_ROAD_WARNING });
    const ring = (event!.where.geometry.coordinates as number[][][])[0]!;

    expect(ring[0]).toEqual(ring.at(-1));
    for (const [lon, lat] of ring) {
      expect(lon).toBeGreaterThan(22);
      expect(lon).toBeLessThan(27.5);
      expect(lat).toBeGreaterThan(59.5);
      expect(lat).toBeLessThan(61);
    }
  });

  it("updates the existing Event when an Update supersedes the alert", () => {
    const first = toEvents([roadAlert], { source, region, now: BEFORE_ROAD_WARNING });
    const [updated] = toEvents([roadUpdate], { source, region, now: BEFORE_ROAD_WARNING, previous: first });

    expect(roadUpdate.references.map((r) => r.identifier)).toContain(roadAlert.identifier);
    expect(updated!.id).toBe(first[0]!.id);
    expect(updated!.sources[0]!.id).toBe(roadUpdate.identifier);
    expect(updated!.updatedAt).toBe(new Date(roadUpdate.sent).toISOString());
  });

  it("finds the Event through earlier ids too, so a chain of Updates keeps one Event", () => {
    const first = toEvents([roadAlert], { source, region, now: BEFORE_ROAD_WARNING });
    const second = toEvents([roadUpdate], { source, region, now: BEFORE_ROAD_WARNING, previous: first });
    const third: CapAlert = { ...roadUpdate, identifier: "next", sent: "2026-01-05T08:00:00+02:00", references: [{ sender: roadUpdate.sender, identifier: roadUpdate.identifier, sent: roadUpdate.sent }] };

    expect(toEvents([third], { source, region, now: BEFORE_ROAD_WARNING, previous: second })[0]!.id).toBe(first[0]!.id);
  });

  it("keeps one Event when the alert and its Update are in the same feed", () => {
    const events = toEvents([roadUpdate, roadAlert], { source, region, now: BEFORE_ROAD_WARNING });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: `fmi-warnings:${roadAlert.identifier}`, sources: [{ id: roadUpdate.identifier }] });
  });

  it("resolves the existing Event when a Cancel withdraws it, keeping what it was", () => {
    const now = new Date("2026-01-02T09:30:00Z");
    const [before] = toEvents([seaUpdate], { source, region, now });
    const [after] = toEvents([seaCancel], { source, region, now, previous: [before!] });

    expect(before).toMatchObject({ status: "active", mainlyAffected: "nobody" });
    expect(after).toMatchObject({
      id: before!.id,
      title: before!.title,
      status: "resolved",
      when: { start: before!.when.start, end: "2026-01-02T09:22:30.000Z" },
      sources: [{ id: seaCancel.identifier }],
    });
  });

  it("resolves a Cancel for an Event it hasn't seen, as its own Event", () => {
    const [event] = toEvents([seaCancel], { source, region, now: new Date("2026-01-02T09:30:00Z") });

    expect(event).toMatchObject({ id: `fmi-warnings:${seaUpdate.identifier}`, status: "resolved" });
  });

  it("makes an orange warning major", () => {
    const [event] = toEvents([orangeRoad], { source, region, now: DURING_FEB_WARNINGS });

    expect(orangeRoad.infos[0]!.severity).toBe("Severe");
    expect(event).toMatchObject({
      title: { en: "Orange traffic weather warning: The southern part of the country, Thu 0.00 - Fri 0.00" },
      severity: "major",
      mainlyAffected: "drivers",
      status: "active",
    });
  });

  it("says a slippery-pavement warning is mainly for pedestrians", () => {
    const [event] = toEvents([pavement], { source, region, now: DURING_FEB_WARNINGS });

    expect(event).toMatchObject({
      title: { en: "Yellow pedestrian weather warning: Locally in the western part of the country, Thu 16.00 - Fri 0.00" },
      severity: "consider",
      mainlyAffected: "pedestrians",
      status: "active",
    });
  });

  it("maps every CAP severity: Severe or Extreme (orange, red) → major, Moderate (yellow) → consider", () => {
    const withSeverity = (severity: string) => {
      const alert: CapAlert = { ...roadAlert, infos: roadAlert.infos.map((i) => ({ ...i, severity })) };
      return toEvents([alert], { source, region, now: BEFORE_ROAD_WARNING })[0]!.severity;
    };

    expect(withSeverity("Extreme")).toBe("major");
    expect(withSeverity("Severe")).toBe("major");
    expect(withSeverity("Moderate")).toBe("consider");
    expect(withSeverity("Minor")).toBe("minor");
    expect(withSeverity("Unknown")).toBe("info");
  });

  it("knows nothing about FMI itself: another CAP Source gets its own names, and everyone is affected by default", () => {
    const other: CapSource = { adapter: "cap", id: "met", url: "https://cap.example/feed.xml", publisher: "Some Met Office", license: "CC BY 4.0", refreshMinutes: 10 };
    const [event] = toEvents([roadAlert], { source: other, region, now: BEFORE_ROAD_WARNING });

    expect(event).toMatchObject({ id: `met:${roadAlert.identifier}`, mainlyAffected: "everyone", sources: [{ name: "Some Met Office" }] });
    expect(event!.sources[0]).not.toHaveProperty("attribution");
  });

  it("skips alerts that are tests or exercises", () => {
    expect(toEvents([{ ...roadAlert, status: "Exercise" }], { source, region, now: BEFORE_ROAD_WARNING })).toEqual([]);
  });
});

describe("GET /events?kind=weather", () => {
  it("returns the active warnings covering a point", async () => {
    const store = new InMemoryEventStore();
    await store.replaceSource(source.id, toEvents([roadAlert, seaUpdate], { source, region, now: DURING_ROAD_WARNING }));
    const app = eventRoutes(store, [region], () => DURING_ROAD_WARNING);
    const ids = async (query: string) => ((await (await app.request(`/events${query}`)).json()) as { events: { id: string }[] }).events.map((e) => e.id);

    expect(await ids("?near=60.1699,24.9384&kind=weather")).toEqual([`fmi-warnings:${roadAlert.identifier}`]);
    expect(await ids("?near=60.1699,24.9384&kind=works")).toEqual([]);
  });
});
