import { EventSchema } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import type { LinkedEventsSource } from "../regions/index.ts";
import fixture from "./fixtures/linked-events/events.json" with { type: "json" };
import { fetchEvents, type LinkedEvent, toEvents } from "./linked-events.ts";

// Recorded 2026-11-03 from the live API: events picked from its answers, with only the fields read here kept.
const source = fiCapitalRegion.sources.find((s): s is LinkedEventsSource => s.adapter === "linked-events")!;
const now = new Date("2026-11-03T12:00:00Z");
const context = { source, region: fiCapitalRegion, now };
const recorded = fixture.data as LinkedEvent[];
const events = toEvents(recorded, context);
const byId = (id: string) => events.find((e) => e.sources[0]!.id === id);
const recordedEvent = (id: string) => recorded.find((e) => e.id === id)!;

const HECTOR = "helsinki:agopwe3ph4"; // Veikkaus Arena, rescheduled, "ends" 23:59
const RASKASTA_JOULUA = "helsinki:agpr2ctpee"; // Veikkaus Arena, 18:00–20:00 UTC
const HIFK = "helsinki:agprytxiiy"; // Helsingin jäähalli
const TENNIS_WEEK = "helsinki:agqypswney"; // a week, with an entry per day
const TENNIS_DAYS = ["helsinki:agqypsv6fa", "helsinki:agqypsv7ee", "helsinki:agqypswahi"];
const KIASMA_EXHIBITION = "helsinki:agqv4j26yq"; // October to February
const POSTPONED = "helsinki:af7avifqka";
const CANCELLED = "helsinki:agl6rme7we";
const SMALL = "helsinki:agqyn5hfma"; // a library concert for 48
const ONLINE = "helsinki:agky7xt45i";

describe("Linked Events → Events", () => {
  it("turns big events into valid Public events with crowd, at their place", () => {
    expect(events.map((e) => e.sources[0]!.id).sort()).toEqual([CANCELLED, HECTOR, HIFK, RASKASTA_JOULUA, ...TENNIS_DAYS].sort());
    for (const event of events) {
      expect(EventSchema.safeParse(event).success, event.id).toBe(true);
      expect(event).toMatchObject({ kind: "public_event", layers: ["area", "now"], severity: "minor", mainlyAffected: "everyone", noticeable: ["crowd"] });
    }
  });

  it("maps a HIFK match at the ice hall, with its own times and hours", () => {
    expect(byId(HIFK)).toMatchObject({
      id: `${source.id}:${HIFK}`,
      title: { fi: "HIFK - Jokerit, jääkiekkoa · Helsingin jäähalli", en: "HIFK - Jokerit, ice hockey · Helsingin jäähalli" },
      where: { geometry: { type: "Point", coordinates: [24.922352, 60.18929] }, precision: "exact" },
      when: { start: "2026-11-11T16:30:00Z", end: "2026-11-11T18:30:00Z", dailyHours: { from: "18:30", to: "20:30" } },
      status: "upcoming",
      sources: [{ name: "City of Helsinki", id: HIFK, url: "https://hifk.fi/", license: "CC BY 4.0" }],
      confidence: 1,
    });
    expect(byId(HIFK)!.originalText?.fi).toMatch(/^HIFK:n jääkiekkojoukkue/);
  });

  it("takes a concert at Veikkaus Arena at its times", () => {
    expect(byId(RASKASTA_JOULUA)!.when).toMatchObject({ start: "2026-12-18T18:00:00Z", end: "2026-12-18T20:00:00Z" });
    expect(byId(RASKASTA_JOULUA)!.title.fi).toMatch(/ · Veikkaus Arena$/);
  });

  it("reads an end at 23:59 as unknown: the start plus the usual three hours", () => {
    expect(recordedEvent(HECTOR).end_time).toBe("2026-12-05T21:59:00Z");
    expect(byId(HECTOR)!.when).toMatchObject({ start: "2026-12-05T16:30:00Z", end: "2026-12-05T19:30:00.000Z" });
  });

  it("gives an event without an end the usual three hours", () => {
    const [event] = toEvents([{ ...recordedEvent(HIFK), end_time: null }], context);

    expect(event!.when.end).toBe("2026-11-11T19:30:00.000Z");
  });

  it("takes a rescheduled event at its new times", () => {
    expect(recordedEvent(HECTOR).event_status).toBe("EventRescheduled");
    expect(byId(HECTOR)!.status).toBe("upcoming");
  });

  it("publishes each day of an event split into days, not the event that holds them", () => {
    expect(byId(TENNIS_WEEK)).toBeUndefined();
    expect(TENNIS_DAYS.map((id) => byId(id)?.when.start)).toEqual(["2026-11-15T09:00:00Z", "2026-11-16T09:00:00Z", "2026-11-17T11:00:00Z"]);
  });

  it("leaves out what lasts over a day with no entry per day: an exhibition isn't a crowd", () => {
    expect(byId(KIASMA_EXHIBITION)).toBeUndefined();
  });

  it("judges how long by the calendar's own end, even when it's at 23:59", () => {
    // Ateneum's "Ajan kysymys" ran from 2023 to 23:59 on 31 Dec 2026.
    const exhibition = { ...recordedEvent(KIASMA_EXHIBITION), start_time: "2023-04-13T21:01:00Z", end_time: "2026-12-31T21:59:00Z" };

    expect(toEvents([exhibition], context)).toEqual([]);
  });

  it("skips postponed events, and resolves cancelled ones", () => {
    expect(byId(POSTPONED)).toBeUndefined();
    expect(byId(CANCELLED)?.status).toBe("resolved");
  });

  it("leaves out events at venues under the Region's crowd size", () => {
    expect(recordedEvent(SMALL).maximum_attendee_capacity).toBeLessThan(500);
    expect(byId(SMALL)).toBeUndefined();
  });

  it("leaves out online events, which sit at a stand-in point", () => {
    const online = { ...recordedEvent(ONLINE), start_time: "2026-11-11T16:00:00Z", end_time: "2026-11-11T18:00:00Z" };

    expect(online.location!.position).not.toBeNull();
    expect(toEvents([online], context)).toEqual([]);
  });
});

describe("fetching Linked Events", () => {
  it("asks for big events in the Region over the next two weeks, page by page", async () => {
    const asked: URL[] = [];
    const fetchFn = (async (input: string | URL) => {
      const url = new URL(input);
      asked.push(url);
      const page = url.searchParams.get("page");
      return Response.json(
        page ? { meta: { next: null }, data: recorded.slice(6) } : { meta: { next: `${url.toString()}&page=2` }, data: recorded.slice(0, 6) },
      );
    }) as typeof fetch;

    expect(await fetchEvents(context, fetchFn)).toHaveLength(recorded.length);
    expect(asked).toHaveLength(2);
    expect(Object.fromEntries(asked[0]!.searchParams)).toEqual({
      start: "2026-11-03T12:00:00.000Z",
      end: "2026-11-17T12:00:00.000Z",
      bbox: "24.4,60,25.3,60.45",
      maximum_attendee_capacity_gte: "500",
      include: "location",
      page_size: "100",
    });
  });

  it("fails when the API does", async () => {
    const fetchFn = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;

    await expect(fetchEvents(context, fetchFn)).rejects.toThrow("hel-linked-events: Linked Events responded 503");
  });
});
