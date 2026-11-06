import calendarFixture from "../adapters/fixtures/linked-events/events.json" with { type: "json" };
import { type PermitCollection, toPermitItems } from "../adapters/land-use-permits.ts";
import { type LinkedEvent, toEvents as toCalendarEvents } from "../adapters/linked-events.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import { isPermitSource, type LandUsePermitSource, type LinkedEventsSource } from "../regions/index.ts";
import { type Answers, type ClassifierState, QUESTION_IDS, type Questions } from "./classifier.ts";
import answerKey from "./fixtures/answer-key.json" with { type: "json" };
import calendar from "./fixtures/calendar.json" with { type: "json" };
import permits from "./fixtures/permits.json" with { type: "json" };
import { calendarSubject, subjectFor } from "./questions.ts";
import type { Graded, Label } from "./score.ts";

// The hand-labelled answer key over the recorded notices and calendar events: what the Classifier is asked about each one,
// and the maintainer's answers. Shared by the eval script (live Jev) and the recorded-answers test.

export interface KeyedSubject {
  // The notice's id in the permit system (hakemustunnus), or the event's in the calendar
  id: string;
  layer: LandUsePermitSource["permitType"] | "calendar";
  state: ClassifierState;
  questions: Questions;
}

export function answerKeySubjects(): KeyedSubject[] {
  const labelled = new Set(answerKey.notices.map((n) => n.id));
  const { timeZone } = fiCapitalRegion;
  const now = new Date(`${permits._recorded.at}T12:00:00Z`);
  const layers = permits.layers as Record<string, PermitCollection>;
  const fromPermits = fiCapitalRegion.sources.filter(isPermitSource).flatMap((source) => {
    const collection = layers[source.layer];
    if (!collection) return [];
    return toPermitItems(collection, { source, timeZone, now }).flatMap((item) => {
      const id = item.event.sources[0]!.id;
      const subject = subjectFor(item, source.permitType);
      return labelled.has(id) && subject ? [{ id, layer: source.permitType, ...subject }] : [];
    });
  });

  const source = fiCapitalRegion.sources.find((s): s is LinkedEventsSource => s.adapter === "linked-events")!;
  const recorded = [...calendarFixture.data, ...calendar.data] as LinkedEvent[];
  const fromCalendar = toCalendarEvents(recorded, { source, region: fiCapitalRegion, now }).flatMap((event) => {
    const id = event.sources[0]!.id;
    const subject = calendarSubject(event, timeZone);
    return labelled.has(id) && subject ? [{ id, layer: "calendar" as const, ...subject }] : [];
  });
  return [...fromPermits, ...fromCalendar];
}

// Every question asked, with its label and the Classifier's answer (if any) to it.
export function gradeAnswers(subjects: KeyedSubject[], answers: Record<string, Answers>): (Graded & { id: string })[] {
  const labels = new Map(answerKey.notices.map((n) => [n.id, n as Record<string, unknown>]));
  return subjects.flatMap(({ id, questions }) =>
    QUESTION_IDS.filter((q) => questions[q]).map((question) => ({
      id,
      question,
      label: (labels.get(id)?.[question] ?? null) as Label,
      answer: answers[id]?.[question],
    })),
  );
}

// Answers recorded from a live run, for the test (fixtures/jev-answers.json).
export interface RecordedAnswers {
  _recorded: { at: string; model: string; questionVersion: number };
  answers: Record<string, Answers>;
}
