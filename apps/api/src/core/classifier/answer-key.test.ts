import { describe, expect, it } from "vitest";
import { answerKeySubjects, gradeAnswers, type RecordedAnswers } from "./answer-key.ts";
import { DEFAULT_THRESHOLD } from "./classifier.ts";
import recording from "./fixtures/jev-answers.json" with { type: "json" };
import { QUESTION_VERSION } from "./questions.ts";
import { score } from "./score.ts";

// Grades Jev's recorded answers on real notices against the maintainer's labels (fixtures/answer-key.json).
// Re-record with `pnpm --filter @pulse/api eval:classifier src/core/classifier/fixtures/jev-answers.json`.

const { _recorded, answers } = recording as RecordedAnswers;
const subjects = answerKeySubjects();
const graded = gradeAnswers(subjects, answers);

describe("Jev against the answer key", () => {
  it("is recorded with the current questions", () => {
    expect(_recorded.questionVersion, "questions changed: re-record the answers").toBe(QUESTION_VERSION);
  });

  it("has an answer from the offered choices for every question asked", () => {
    for (const { id, questions } of subjects) {
      for (const [question, asked] of Object.entries(questions)) {
        const answer = answers[id]?.[question as keyof typeof questions];
        expect(answer, `${id} ${question}`).toBeDefined();
        expect(Object.keys(asked.choices), `${id} ${question}`).toContain(answer!.choice);
      }
    }
  });

  it("grades labelled answers from all three permit layers and the calendar", () => {
    const layers = new Set(graded.filter((g) => g.label !== null).map((g) => subjects.find((s) => s.id === g.id)!.layer));

    expect([...layers].sort()).toEqual(["calendar", "excavation", "outdoor-event", "traffic-arrangement"]);
  });

  // The rule the threshold rests on: answers that reach it, and so land on the Event, are nearly always right.
  it.each(["workType", "endDate", "severity", "crowd", "loud", "mainlyAffected"] as const)(
    "%s: at least 85%% of the answers reaching the threshold are right",
    (question) => {
      const s = score(graded, DEFAULT_THRESHOLD)[question]!;

      expect(s.accepted).toBeGreaterThan(0);
      expect(s.acceptedCorrect / s.accepted).toBeGreaterThanOrEqual(0.85);
    },
  );

  // Right but unsure counts for nothing: an answer under the threshold leaves the Event "not sure yet who this affects".
  // Was 11 of 31 at question version 5, with digs at a building's address answered "nobody".
  it("mainlyAffected: at least half the labelled answers reach the threshold", () => {
    const s = score(graded, DEFAULT_THRESHOLD).mainlyAffected!;

    expect(s.accepted / s.labelled).toBeGreaterThanOrEqual(0.5);
  });

  it("is right at least 90% of the time over all questions at the threshold", () => {
    const all = Object.values(score(graded, DEFAULT_THRESHOLD));
    const accepted = all.reduce((n, s) => n + s.accepted, 0);
    const right = all.reduce((n, s) => n + s.acceptedCorrect, 0);

    expect(right / accepted).toBeGreaterThanOrEqual(0.9);
  });
});
