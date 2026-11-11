import type { Event } from "@pulse/client";
import { describe, expect, it } from "vitest";
import { circleAround, groupNear, nearestFirst, outlineOf, pinsFor, plainTitle, regionWide, pickedText, sameSpot, sectionsOf, startsOf, summaryOf, textIn, toneOf, untilOf, whenOf } from "./events.ts";

const base: Event = {
  id: "src:1",
  kind: "works",
  layers: ["area"],
  title: { fi: "Kaivutyö · Hämeentie 12", en: "Excavation · Hämeentie 12" },
  where: { geometry: { type: "Point", coordinates: [24.95, 60.18] }, precision: "area" },
  when: { start: "2026-10-01T00:00:00+03:00" },
  severity: "minor",
  mainlyAffected: "drivers",
  noticeable: ["noise"],
  status: "active",
  sources: [{ name: "City", id: "1", updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0,
  updatedAt: "2026-10-01T00:00:00+03:00",
};
const event = (patch: Partial<Event>): Event => ({ ...base, ...patch });
const here = { lat: 60.17, lon: 24.95 };

describe("where an Event's pins go", () => {
  it("puts a point's pin on it", () => {
    expect(pinsFor(base)).toEqual([[24.95, 60.18]]);
  });

  it("gives every transit stop its own pin", () => {
    const stops = event({ where: { geometry: { type: "MultiPoint", coordinates: [[24.9, 60.1], [24.91, 60.11]] }, precision: "exact" } });

    expect(pinsFor(stops)).toEqual([[24.9, 60.1], [24.91, 60.11]]);
  });

  it("puts an area's pin in the middle of its largest part", () => {
    const area = event({
      where: {
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [[[24.0, 60.0], [24.001, 60.0], [24.001, 60.001], [24.0, 60.0]]],
            [[[25.0, 61.0], [25.2, 61.0], [25.2, 61.2], [25.0, 61.2], [25.0, 61.0]]],
          ],
        },
        precision: "area",
      },
    });

    expect(pinsFor(area)).toEqual([[25.1, 61.1]]);
  });

  it("gives a vague Event no pin: it isn't drawn as if it were there", () => {
    expect(pinsFor(event({ where: { ...base.where, precision: "vague" } }))).toEqual([]);
  });
});

describe("how much an Event matters, as a colour", () => {
  it("keeps info and minor quiet, and marks consider and major", () => {
    expect(["info", "minor", "consider", "major"].map((severity) => toneOf(event({ severity: severity as Event["severity"] })))).toEqual([
      "quiet",
      "quiet",
      "consider",
      "major",
    ]);
  });
});

describe("home's sections", () => {
  const at = (lat: number) => ({ where: { ...base.where, geometry: { type: "Point" as const, coordinates: [24.95, lat] } } });
  const vague = { where: { ...base.where, precision: "vague" as const } };
  const ids = (events: Event[]) => events.map((e) => e.id);

  it("puts what's worth considering or major in your way, region-wide notices first, then nearest", () => {
    const { inYourWay } = sectionsOf(
      [event({ id: "far", severity: "major", ...at(60.2) }), event({ id: "near", severity: "consider", ...at(60.171) }), event({ id: "strike", severity: "consider", ...vague })],
      [],
      here,
    );

    expect(ids(inYourWay)).toEqual(["strike", "near", "far"]);
  });

  it("puts the rest you'd notice on site around you, and leaves out what you wouldn't", () => {
    const { inYourWay, aroundYou } = sectionsOf([event({ id: "loud", noticeable: ["noise"] }), event({ id: "quiet", noticeable: [] })], [], here);

    expect(ids(inYourWay)).toEqual([]);
    expect(ids(aroundYou)).toEqual(["loud"]);
  });

  it("leaves out what's in nobody's way, and a line's alert it can't place", () => {
    const { inYourWay } = sectionsOf(
      [event({ id: "sea", severity: "major", mainlyAffected: "nobody" }), event({ id: "majvik", severity: "major", where: { ...vague.where, lines: ["HSL:9841"] } })],
      [],
      here,
    );

    expect(inYourWay).toEqual([]);
  });

  it("lists what's coming up soonest first, worth considering or major, and not already going on", () => {
    const going = event({ id: "going", severity: "major" });
    const { comingUp } = sectionsOf(
      [going],
      [
        going,
        event({ id: "later", severity: "consider", status: "upcoming", when: { start: "2026-11-20T00:00:00+02:00" } }),
        event({ id: "sooner", severity: "major", status: "upcoming", when: { start: "2026-11-12T00:00:00+02:00" } }),
        event({ id: "small", severity: "minor", status: "upcoming", when: { start: "2026-11-11T00:00:00+02:00" } }),
      ],
      here,
    );

    expect(ids(comingUp)).toEqual(["sooner", "later"]);
  });
});

describe("the summary line", () => {
  it("counts what's in your way and names the major ones", () => {
    const sections = sectionsOf([event({ id: "1", severity: "consider" }), event({ id: "2", severity: "major" })], [], here);

    expect(summaryOf(sections)).toEqual({ key: "summaryInWay", count: 2, major: 1 });
  });

  it("says nothing out of the ordinary, never all clear, when nothing is in your way", () => {
    expect(summaryOf(sectionsOf([event({ noticeable: ["noise"] })], [], here))).toEqual({ key: "summaryNothing" });
  });
});

describe("a picked time", () => {
  it("reads in Finnish numbers", () => {
    expect(pickedText("2026-12-12T18:00")).toBe("12.12.2026 18.00");
    expect(pickedText("2027-01-05T07:30")).toBe("5.1.2027 7.30");
  });
});

describe("the order of pins", () => {
  it("is nearest first, so keyboard and screen-reader users meet the closest Event first", () => {
    const far = event({ id: "far", where: { ...base.where, geometry: { type: "Point", coordinates: [24.95, 60.2] } } });
    const near = event({ id: "near", where: { ...base.where, geometry: { type: "Point", coordinates: [24.95, 60.171] } } });

    expect(nearestFirst([far, near], here).map((p) => p.event.id)).toEqual(["near", "far"]);
  });
});

describe("an Event's text", () => {
  it("is in the first of the reader's languages the Event has", () => {
    expect(textIn(base.title, ["sv", "en", "fi"])).toBe("Excavation · Hämeentie 12");
  });

  it("falls back to any language it has", () => {
    expect(textIn({ sv: "Grävarbete" }, ["en", "fi"])).toBe("Grävarbete");
  });
});

describe("when an Event is, in Finnish dates", () => {
  const timeZone = "Europe/Helsinki";
  const now = new Date("2026-10-30T12:00:00+02:00");
  const when = (w: Event["when"], status: Event["status"] = "active") => whenOf(event({ when: w, status }), timeZone, now);

  it("says until when something going on lasts, always with the year", () => {
    expect(when({ start: "2026-10-01T07:00:00+03:00", end: "2027-12-31T23:59:59+02:00" })).toEqual({ key: "whenUntil", end: "31.12.2027" });
  });

  it("says it's going on with no end date when it has none", () => {
    expect(when({ start: "2026-10-01T07:00:00+03:00" })).toEqual({ key: "whenOngoing" });
  });

  it("gives the dates of something coming up", () => {
    expect(when({ start: "2026-12-01T07:00:00+02:00", end: "2026-12-14T16:00:00+02:00" }, "upcoming")).toEqual({
      key: "whenFromTo",
      start: "1.12.2026",
      end: "14.12.2026",
    });
    expect(when({ start: "2026-12-01T07:00:00+02:00" }, "upcoming")).toEqual({ key: "whenFrom", start: "1.12.2026" });
  });

  it("gives the times of what starts and ends on one day, and says today for today", () => {
    expect(when({ start: "2026-10-30T18:00:00+02:00", end: "2026-10-30T21:30:00+02:00" }, "upcoming")).toEqual({ key: "whenToday", from: "18.00", to: "21.30" });
    expect(when({ start: "2026-11-13T17:00:00+02:00", end: "2026-11-13T23:30:00+02:00", dailyHours: { from: "17:00", to: "23:30" } }, "upcoming")).toEqual({
      key: "whenOnDay",
      day: "13.11.2026",
      from: "17.00",
      to: "23.30",
    });
  });

  it("says when something ended", () => {
    expect(when({ start: "2026-10-01T07:00:00+03:00", end: "2026-10-29T16:00:00+02:00" }, "resolved")).toEqual({ key: "whenEnded", end: "29.10.2026" });
  });

  it("reads dates in the Region's time zone, not the device's", () => {
    // 23:30 UTC on the 12th is already the 13th in Helsinki.
    expect(when({ start: "2026-10-01T07:00:00Z", end: "2026-11-12T23:30:00Z" })).toEqual({ key: "whenUntil", end: "13.11.2026" });
  });

  it("adds the daily hours, in Finnish clock times: weekdays, every day, or the days named", () => {
    const start = "2026-10-01T07:00:00+03:00";
    expect(when({ start, dailyHours: { from: "07:00", to: "16:00", days: ["mon", "tue", "wed", "thu", "fri"] } })).toMatchObject({
      hours: { key: "hoursWeekdays", from: "7.00", to: "16.00" },
    });
    expect(when({ start, dailyHours: { from: "22:00", to: "05:00" } })).toMatchObject({ hours: { key: "hoursDaily", from: "22.00", to: "5.00" } });
    expect(when({ start, dailyHours: { from: "10:00", to: "14:00", days: ["sat", "sun"] } })).toMatchObject({
      hours: { key: "hoursDays", days: "Sat, Sun", from: "10.00", to: "14.00" },
    });
  });
});

describe("what a card calls an Event", () => {
  const titled = (title: string, patch: Partial<Event> = {}) => plainTitle(event({ title: { en: title }, ...patch }), ["en"]);

  it("splits the Source's title into what and where", () => {
    expect(titled("Bridge closed · Hopeasalmentien silta, Kulosaari")).toEqual({ title: "Bridge closed", address: "Hopeasalmentien silta, Kulosaari" });
  });

  it("keeps a title with no place in it whole", () => {
    expect(titled("The Tynnyrintekijänkatu stop will be closed from 19 October.")).toEqual({ title: "The Tynnyrintekijänkatu stop will be closed from 19 October." });
  });

  it("says what a permit is with its text's first sentence, when its title is only the category", () => {
    const text = (fi: string) => ({ originalText: { fi }, title: { en: "Traffic arrangement · Samoankuja" }, kind: "closure" as const });
    expect(plainTitle(event(text("Tilapäinen reitti kävelijöille.\n\nLISÄYS 8.7.2025: lisäaikaa 2.6.2025 - 1.2.2026.")), ["en"])).toEqual({
      title: "Traffic arrangement",
      address: "Samoankuja",
      what: "Tilapäinen reitti kävelijöille",
    });
    expect(plainTitle(event(text("Tilapäinen jalankulun ja pyöräilyn väylä ja suojatiet .")), ["en"]).what).toBe("Tilapäinen jalankulun ja pyöräilyn väylä ja suojatiet");
    expect(plainTitle(event(text("Laajasalontien liikennejärjestelyt. Lisätietoja työmaalta.")), ["en"]).what).toBe("Laajasalontien liikennejärjestelyt");
    expect(plainTitle(event(text("Työstä vastaava varaa tilaa tilapäisille liikennemerkeille.")), ["en"]).what).toBe("Tilapäisille liikennemerkeille");
    expect(plainTitle(event(text("Päätöksensaaja varaa tilaa raskassuojille.")), ["en"]).what).toBe("Raskassuojille");
  });

  it("keeps a dig's kind of work, and a public event's name, over its text", () => {
    expect(titled("Excavation · Mannerheimintie 5", { workType: "electricity_telecom", originalText: { fi: "Kaapelityö." } }).what).toBeUndefined();
    expect(titled("Fan Fest · Kamppi", { kind: "public_event", originalText: { fi: "Tule mukaan!" } }).what).toBeUndefined();
    expect(titled("Excavation · Mannerheimintie 5", { originalText: { fi: "Kaukolämpöjohdon korjaus." } }).what).toBe("Kaukolämpöjohdon korjaus");
  });

  it("gives a dig's kind of work, for the card to name in plain words", () => {
    expect(titled("Excavation · Messitytönkatu 2", { workType: "water_sewer" })).toEqual({ title: "Excavation", address: "Messitytönkatu 2", workType: "water_sewer" });
  });
});

describe("what the map draws besides pins", () => {
  const dig = event({ where: { geometry: { type: "Polygon", coordinates: [[[24.95, 60.18], [24.952, 60.18], [24.952, 60.181], [24.95, 60.18]]] }, precision: "area" } });
  const county = event({ where: { geometry: { type: "Polygon", coordinates: [[[24, 60], [25.5, 60], [25.5, 60.6], [24, 60]]] }, precision: "area" } });
  const road = event({ where: { geometry: { type: "LineString", coordinates: [[24.95, 60.18], [24.96, 60.18]] }, precision: "segment" } });
  const alert = event({ where: { geometry: county.where.geometry, precision: "vague" } });

  it("outlines a works area and a road, not a point, a vague Event or a county-wide warning", () => {
    expect(outlineOf(dig)).toEqual(dig.where.geometry);
    expect(outlineOf(road)).toEqual(road.where.geometry);
    expect(outlineOf(base)).toBeUndefined();
    expect(outlineOf(alert)).toBeUndefined();
    expect(outlineOf(county)).toBeUndefined();
  });

  it("counts what's region-wide apart: vague Events have no pin", () => {
    expect(regionWide([dig, alert, base])).toEqual([alert]);
  });

  it("draws how far the map looks as a closed ring the radius away", () => {
    const ring = circleAround(here, 500);
    const [lon, lat] = ring[16]!;

    expect(ring[0]).toEqual(ring.at(-1));
    expect((lat - here.lat) * 111_320).toBeCloseTo(500, 0);
    expect(lon).toBeCloseTo(here.lon, 6);
  });
});

describe("grouping pins that overlap", () => {
  it("groups what's closer than the distance on screen, around the nearest one", () => {
    const points = [{ id: "a", x: 0, y: 0 }, { id: "far", x: 100, y: 0 }, { id: "b", x: 20, y: 10 }, { id: "c", x: 110, y: 5 }];

    expect(groupNear(points, 40).map((g) => g.map((p) => p.id))).toEqual([["a", "b"], ["far", "c"]]);
  });

  it("tells pins at one spot from pins that zooming in would part", () => {
    expect(sameSpot([{ lngLat: [24.95, 60.18] }, { lngLat: [24.95, 60.18] }])).toBe(true);
    expect(sameSpot([{ lngLat: [24.95, 60.18] }, { lngLat: [24.951, 60.18] }])).toBe(false);
  });
});

describe("what a row on Home leads with", () => {
  const now = new Date("2026-11-10T22:30:00+02:00");
  const lasting = (when: Event["when"]) => event({ when, status: "active" });

  it("says when what's in your way ends: a date, a time today, or that there's no end date", () => {
    expect(untilOf(lasting({ start: "2026-10-01T00:00:00+03:00", end: "2027-04-01T00:00:00+03:00" }), "Europe/Helsinki", now)).toEqual({ key: "rowUntil", value: "1.4.2027" });
    expect(untilOf(lasting({ start: "2026-11-10T20:00:00+02:00", end: "2026-11-10T23:30:00+02:00" }), "Europe/Helsinki", now)).toEqual({ key: "rowUntil", value: "23.30" });
    expect(untilOf(lasting({ start: "2026-10-01T00:00:00+03:00" }), "Europe/Helsinki", now)).toEqual({ key: "rowNoEnd" });
  });

  it("counts the days until what's coming up starts on the Region's calendar, not in 24-hour steps", () => {
    expect(startsOf(lasting({ start: "2026-11-10T23:00:00+02:00" }), "Europe/Helsinki", now)).toEqual({ key: "rowToday" });
    expect(startsOf(lasting({ start: "2026-11-11T00:30:00+02:00" }), "Europe/Helsinki", now)).toEqual({ key: "rowTomorrow" });
    expect(startsOf(lasting({ start: "2026-11-13T08:00:00+02:00" }), "Europe/Helsinki", now)).toEqual({ key: "rowInDays", count: 3 });
  });
});
