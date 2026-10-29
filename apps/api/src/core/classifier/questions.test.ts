import { describe, expect, it } from "vitest";
import excavations from "../adapters/fixtures/land-use-permits/excavations.json" with { type: "json" };
import outdoorEvents from "../adapters/fixtures/land-use-permits/outdoor-events.json" with { type: "json" };
import trafficArrangements from "../adapters/fixtures/land-use-permits/traffic-arrangements.json" with { type: "json" };
import { type PermitCollection, toPermitItems } from "../adapters/land-use-permits.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { isPermitSource, type LandUsePermitSource } from "../regions/index.ts";
import { NOT_STATED } from "./classifier.ts";
import { candidateDates, subjectFor } from "./questions.ts";

const now = new Date("2026-10-24T12:00:00+03:00");
const itemsOf = (collection: unknown, permitType: LandUsePermitSource["permitType"]) =>
  toPermitItems(collection as PermitCollection, {
    source: fiCapitalRegion.sources.filter(isPermitSource).find((s) => s.permitType === permitType)!,
    timeZone: fiCapitalRegion.timeZone,
    now,
  });

describe("candidateDates", () => {
  it("finds Finnish and ISO dates in text order, as YYYY-MM-DD", () => {
    expect(candidateDates("MUUTOS 22.10.2026: 05.10.2026 - 23.10.2026 -> 29.10.2026 - 13.11.2026, ks. 2027-01-05")).toEqual([
      "2026-10-22",
      "2026-10-05",
      "2026-10-23",
      "2026-10-29",
      "2026-11-13",
      "2027-01-05",
    ]);
  });

  it("accepts single-digit days and months", () => {
    expect(candidateDates("Työ päättyy 9.8.2027.")).toEqual(["2027-08-09"]);
  });

  it("lists each date once", () => {
    expect(candidateDates("13.11.2026 ja vielä 13.11.2026")).toEqual(["2026-11-13"]);
  });

  it("skips impossible dates and digits that only look like dates", () => {
    expect(candidateDates("31.02.2026, 1.13.2026, puh. 040.12.34567, 2026-13-01")).toEqual([]);
  });

  it("finds nothing in text without dates", () => {
    expect(candidateDates("Tonttiliitosten uusinta")).toEqual([]);
  });

  it("takes a date's missing year from the next full date in the text", () => {
    expect(candidateDates("Voimassa 15.5.-31.12.2025")).toEqual(["2025-05-15", "2025-12-31"]);
    expect(candidateDates("muutos 05.10. - 23.10.2026 -> 29.10. - 13.11.2027")).toEqual([
      "2026-10-05",
      "2026-10-23",
      "2027-10-29",
      "2027-11-13",
    ]);
  });

  it("skips a date without a year when no full date follows it", () => {
    expect(candidateDates("Työ alkaa 31.12.2026 ja jatkuu 5.1. alkaen")).toEqual(["2026-12-31"]);
  });

  it("accepts a space before the year", () => {
    expect(candidateDates("Työ päättyy 9.10. 2026")).toEqual(["2026-10-09"]);
  });

  it("skips impossible dates without a year too", () => {
    expect(candidateDates("31.2.-5.3.2026")).toEqual(["2026-03-05"]);
  });
});

describe("subjectFor", () => {
  const digs = itemsOf(excavations, "excavation");
  const dig = (id: string) => digs.find((i) => i.event.sources[0]!.id === id)!;

  it("asks digs the kind of work, the current end date and who is mainly affected, never Severity", () => {
    const subject = subjectFor(dig("KP2602791-2"), "excavation")!;

    expect(Object.keys(subject.questions).sort()).toEqual(["endDate", "mainlyAffected", "workType"]);
    expect(subject.state.text).toMatch(/^Sadevesiviemärin korjaus/);
  });

  it("offers only the dates found in the text, plus not stated", () => {
    const subject = subjectFor(dig("KP2602791-2"), "excavation")!;

    expect(Object.keys(subject.questions.endDate!.choices)).toEqual([
      "2026-10-22",
      "2026-10-05",
      "2026-10-23",
      "2026-10-29",
      "2026-11-13",
      NOT_STATED,
    ]);
  });

  it("doesn't ask for an end date when the text has no dates", () => {
    const subject = subjectFor(dig("KP2602966"), "excavation")!;

    expect(subject.questions).not.toHaveProperty("endDate");
    expect(Object.keys(subject.questions).sort()).toEqual(["mainlyAffected", "workType"]);
  });

  it("has nothing to ask about a dig without text", () => {
    const item = dig("KP2602966");
    const { originalText: _, ...withoutText } = item.event;

    expect(subjectFor({ ...item, event: withoutText }, "excavation")).toBeNull();
  });

  it("asks traffic arrangements and outdoor events Severity and who is mainly affected", () => {
    const arrangement = itemsOf(trafficArrangements, "traffic-arrangement")[0]!;
    const outdoorEvent = itemsOf(outdoorEvents, "outdoor-event")[0]!;

    for (const [item, permitType] of [
      [arrangement, "traffic-arrangement"],
      [outdoorEvent, "outdoor-event"],
    ] as const) {
      const subject = subjectFor(item, permitType)!;
      expect(Object.keys(subject.questions).sort()).toEqual(["mainlyAffected", "severity"]);
      expect(subject.state.title).toBe(item.event.title.fi);
    }
  });

  it("tells the Classifier how many days the notice lasts", () => {
    const lucia = itemsOf(trafficArrangements, "traffic-arrangement").find((i) => i.event.sources[0]!.id === "LJ2600093")!;

    expect(subjectFor(lucia, "traffic-arrangement")!.state.durationDays).toBe(1);
  });

  it("passes the Adapter's internal facts, such as the permit's category, without putting them on the Event", () => {
    const arrangement = itemsOf(trafficArrangements, "traffic-arrangement").find((i) => i.event.sources[0]!.id === "LJ2600067")!;
    const market = itemsOf(outdoorEvents, "outdoor-event").find((i) => i.event.sources[0]!.id === "TP2500373")!;

    expect(subjectFor(arrangement, "traffic-arrangement")!.state).toMatchObject({
      category: "Muu",
      address: "Castréninkatu 10",
    });
    // Build-up 9.–26.11., the market 27.11.–22.12., teardown 23.–30.12.
    expect(subjectFor(market, "outdoor-event")!.state).toMatchObject({
      category: "Ulkoilmatapahtuma",
      entry: "Avoin",
      buildUpDays: 18,
      eventDays: 26,
      teardownDays: 8,
    });
    expect(subjectFor(market, "outdoor-event")!.state.address).toMatch(/pysäköintialue$/);
    expect(JSON.stringify(market.event)).not.toContain("Ulkoilmatapahtuma");
  });

  it("never offers 'unknown' as an answer: that is the fallback, not a choice", () => {
    const subject = subjectFor(dig("KP2602791-2"), "excavation")!;

    expect(subject.questions.mainlyAffected!.choices).not.toHaveProperty("unknown");
  });
});
