import { EventSchema, type Event } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import excavations from "../adapters/fixtures/land-use-permits/excavations.json" with { type: "json" };
import outdoorEvents from "../adapters/fixtures/land-use-permits/outdoor-events.json" with { type: "json" };
import trafficArrangements from "../adapters/fixtures/land-use-permits/traffic-arrangements.json" with { type: "json" };
import { type PermitCollection, type PermitItem, toPermitItems } from "../adapters/land-use-permits.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { isPermitSource, type LandUsePermitSource } from "../regions/index.ts";
import { type Answers, applyAnswers, type Classifier, DEFAULT_THRESHOLD, NOT_STATED } from "./classifier.ts";
import { subjectFor } from "./questions.ts";

type PermitType = LandUsePermitSource["permitType"];

const now = new Date("2026-10-24T12:00:00+03:00");
const fixtures: Record<PermitType, unknown> = {
  excavation: excavations,
  "traffic-arrangement": trafficArrangements,
  "outdoor-event": outdoorEvents,
};
const { timeZone } = fiCapitalRegion;
const eventOf = (permitType: PermitType, id: string): PermitItem =>
  toPermitItems(fixtures[permitType] as PermitCollection, {
    source: fiCapitalRegion.sources.filter(isPermitSource).find((s) => s.permitType === permitType)!,
    timeZone,
    now,
  }).find((i) => i.event.sources[0]!.id === id)!;

// A fake Classifier: gives fixed answers to whichever of its questions it is asked, and remembers what it read.
function fakeClassifier(answers: Answers): Classifier & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    model: "fake-1",
    asked,
    async classify(_state, questions) {
      asked.push(Object.keys(questions));
      return Object.fromEntries(Object.entries(answers).filter(([id]) => id in questions));
    },
  };
}

// Runs one Event through the Classifier as the refresh loop will.
async function classify(item: PermitItem, permitType: PermitType, classifier: Classifier, threshold = DEFAULT_THRESHOLD): Promise<Event> {
  const subject = subjectFor(item, permitType)!;
  const answers = await classifier.classify(subject.state, subject.questions);
  return applyAnswers(item.event, subject.questions, answers, { threshold, timeZone });
}

const sure = (choice: string, confidence = 0.9) => ({ choice, confidence });

describe("enriching Events per layer", () => {
  const everything: Answers = {
    workType: sure("water_sewer", 0.95),
    endDate: sure("2026-11-13", 0.85),
    severity: sure("major", 0.91),
    mainlyAffected: sure("drivers", 0.8),
  };

  it("gives a dig its kind of work and who is mainly affected, keeping the default Severity", async () => {
    const classifier = fakeClassifier(everything);
    const event = await classify(eventOf("excavation", "KP2602791-2"), "excavation", classifier);

    expect(classifier.asked).toEqual([["workType", "endDate", "mainlyAffected"]]);
    expect(event).toMatchObject({ workType: "water_sewer", mainlyAffected: "drivers", severity: "minor" });
    expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("gives a traffic arrangement its Severity and who is mainly affected, and no kind of work", async () => {
    const event = await classify(eventOf("traffic-arrangement", "LJ2600093"), "traffic-arrangement", fakeClassifier(everything));

    expect(event).toMatchObject({ severity: "major", mainlyAffected: "drivers" });
    expect(event).not.toHaveProperty("workType");
    expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("gives an outdoor event its Severity and who is mainly affected", async () => {
    const event = await classify(
      eventOf("outdoor-event", "TP2500373"),
      "outdoor-event",
      fakeClassifier({ severity: sure("consider"), mainlyAffected: sure("pedestrians") }),
    );

    expect(event).toMatchObject({ severity: "consider", mainlyAffected: "pedestrians" });
    expect(EventSchema.safeParse(event).success).toBe(true);
  });
});

describe("the confidence threshold", () => {
  const arrangement = eventOf("traffic-arrangement", "LJ2600093");

  it("keeps the defaults for answers below the threshold", async () => {
    const event = await classify(
      arrangement,
      "traffic-arrangement",
      fakeClassifier({ severity: sure("major", 0.39), mainlyAffected: sure("parking", 0.59) }),
    );

    expect(event).toMatchObject({ severity: "consider", mainlyAffected: "unknown" });
  });

  it("counts an answer exactly at the threshold", async () => {
    const event = await classify(arrangement, "traffic-arrangement", fakeClassifier({ severity: sure("major", 0.6) }));

    expect(event.severity).toBe("major");
  });

  it("uses the threshold it is given", async () => {
    const event = await classify(arrangement, "traffic-arrangement", fakeClassifier({ severity: sure("major", 0.8) }), 0.85);

    expect(event.severity).toBe("consider");
  });

  it("leaves a dig without a kind of work when the answer is unsure", async () => {
    const event = await classify(eventOf("excavation", "KP2602966"), "excavation", fakeClassifier({ workType: sure("paving", 0.5) }));

    expect(event).not.toHaveProperty("workType");
  });

  it("ignores an answer that isn't one of the choices, however confident", async () => {
    const event = await classify(
      eventOf("excavation", "KP2602791-2"),
      "excavation",
      fakeClassifier({ workType: sure("gardening", 0.99), endDate: sure("2030-01-01", 0.99), mainlyAffected: sure("unknown", 0.99) }),
    );

    expect(event).not.toHaveProperty("workType");
    expect(event.when).not.toHaveProperty("endConflict");
    expect(event.mainlyAffected).toBe("unknown");
    expect(event.confidence).toBe(0);
  });
});

describe("the Event's confidence", () => {
  const arrangement = eventOf("traffic-arrangement", "LJ2600093");

  it("is the lowest confidence among the answers that counted", async () => {
    const event = await classify(
      arrangement,
      "traffic-arrangement",
      fakeClassifier({ severity: sure("major", 0.91), mainlyAffected: sure("everyone", 0.75) }),
    );

    expect(event.confidence).toBe(0.75);
  });

  it("ignores answers that didn't count when some did", async () => {
    const event = await classify(
      arrangement,
      "traffic-arrangement",
      fakeClassifier({ severity: sure("major", 0.91), mainlyAffected: sure("everyone", 0.3) }),
    );

    expect(event.confidence).toBe(0.91);
  });

  it("is the highest raw confidence when none counted, so it stays below the threshold", async () => {
    const event = await classify(
      arrangement,
      "traffic-arrangement",
      fakeClassifier({ severity: sure("major", 0.39), mainlyAffected: sure("parking", 0.52) }),
    );

    expect(event.confidence).toBe(0.52);
    expect(event.confidence).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it("stays 0, not yet classified, when there are no answers", async () => {
    const event = await classify(arrangement, "traffic-arrangement", fakeClassifier({}));

    expect(event.confidence).toBe(0);
  });
});

describe("the dig's current end date", () => {
  // The city's tyo_paattyy for this notice is 2026-11-13; its change log names five dates.
  const dig = eventOf("excavation", "KP2602791-2");

  it("adds nothing when the text agrees with the city's end date", async () => {
    const event = await classify(dig, "excavation", fakeClassifier({ endDate: sure("2026-11-13") }));

    expect(event.when).toEqual(dig.event.when);
    expect(event.confidence).toBe(0.9);
  });

  it("keeps the city's end date and flags the conflict when the text disagrees", async () => {
    const event = await classify(dig, "excavation", fakeClassifier({ endDate: sure("2026-10-23") }));

    expect(event.when.end).toBe(dig.event.when.end);
    expect(event.when.endConflict).toEqual({ field: "2026-11-13", text: "2026-10-23" });
    expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("flags nothing when the text states no end date", async () => {
    const event = await classify(dig, "excavation", fakeClassifier({ endDate: sure(NOT_STATED, 0.8) }));

    expect(event.when).not.toHaveProperty("endConflict");
    expect(event.confidence).toBe(0.8);
  });

  it("takes the text's end date, to the end of that local day, when the city gives none", async () => {
    const { end: _, ...start } = dig.event.when;
    const event = await classify({ ...dig, event: { ...dig.event, when: start } }, "excavation", fakeClassifier({ endDate: sure("2026-10-23") }));

    expect(event.when).toEqual({ start: dig.event.when.start, end: "2026-10-23T23:59:59+03:00" });
  });

  it("flags nothing when the city's end date is one its rules set, not the work's own", async () => {
    // Helsinki dates winter digs to 14 May, when the permanent paving can be laid.
    const winterDig = { ...dig.event, when: { ...dig.event.when, end: "2027-05-14T23:59:59+03:00" } };
    const subject = subjectFor({ ...dig, event: winterDig }, "excavation")!;
    const answers = { endDate: sure("2026-11-13") };

    const flagged = applyAnswers(winterDig, subject.questions, answers, { threshold: DEFAULT_THRESHOLD, timeZone });
    const ruled = applyAnswers(winterDig, subject.questions, answers, {
      threshold: DEFAULT_THRESHOLD,
      timeZone,
      ruleEndDays: ["05-14"],
    });

    expect(flagged.when.endConflict).toEqual({ field: "2027-05-14", text: "2026-11-13" });
    expect(ruled.when).toEqual(winterDig.when);
    expect(ruled.confidence).toBe(0.9);
  });

  it("flags nothing for an unsure end date", async () => {
    const event = await classify(dig, "excavation", fakeClassifier({ endDate: sure("2026-10-23", 0.5) }));

    expect(event.when).not.toHaveProperty("endConflict");
  });
});

describe("applyAnswers", () => {
  it("doesn't change the Event it is given", async () => {
    const dig = eventOf("excavation", "KP2602791-2");
    const before = structuredClone(dig.event);
    await classify(dig, "excavation", fakeClassifier({ workType: sure("water_sewer"), endDate: sure("2026-10-23") }));

    expect(dig.event).toEqual(before);
  });
});
