import { type PermitCollection, toPermitItems } from "../adapters/land-use-permits.ts";
import { fiCapitalRegion } from "../regions/fi-capital-region.ts";
import type { LandUsePermitSource } from "../regions/index.ts";
import { type Answers, type ClassifierState, QUESTION_IDS, type Questions } from "./classifier.ts";
import answerKey from "./fixtures/answer-key.json" with { type: "json" };
import permits from "./fixtures/permits.json" with { type: "json" };
import { subjectFor } from "./questions.ts";
import type { Graded, Label } from "./score.ts";

// The hand-labelled answer key over the recorded notices: what the Classifier is asked about each one,
// and the maintainer's answers. Shared by the eval script (live Jev) and the recorded-answers test.

export interface KeyedSubject {
  // The notice's id in the permit system (hakemustunnus)
  id: string;
  permitType: LandUsePermitSource["permitType"];
  state: ClassifierState;
  questions: Questions;
}

export function answerKeySubjects(): KeyedSubject[] {
  const labelled = new Set(answerKey.notices.map((n) => n.id));
  const now = new Date(`${permits._recorded.at}T12:00:00Z`);
  const layers = permits.layers as Record<string, PermitCollection>;
  return fiCapitalRegion.sources.flatMap((source) => {
    const collection = layers[source.layer];
    if (!collection) return [];
    return toPermitItems(collection, { source, timeZone: fiCapitalRegion.timeZone, now }).flatMap((item) => {
      const id = item.event.sources[0]!.id;
      const subject = subjectFor(item, source.permitType);
      return labelled.has(id) && subject ? [{ id, permitType: source.permitType, ...subject }] : [];
    });
  });
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
