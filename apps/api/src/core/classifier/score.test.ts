import { describe, expect, it } from "vitest";
import { isCorrect, score } from "./score.ts";

describe("isCorrect", () => {
  it("matches a single label exactly", () => {
    expect(isCorrect("minor", "minor")).toBe(true);
    expect(isCorrect("minor", "major")).toBe(false);
  });

  it("accepts any choice from a list label", () => {
    expect(isCorrect(["pedestrians", "cyclists"], "cyclists")).toBe(true);
    expect(isCorrect(["pedestrians", "cyclists"], "drivers")).toBe(false);
  });
});

describe("score", () => {
  it("counts labelled, answered, accepted and correct answers per question", () => {
    const result = score(
      [
        { question: "severity", label: "major", answer: { choice: "major", confidence: 0.9 } },
        { question: "severity", label: "minor", answer: { choice: "consider", confidence: 0.8 } },
        { question: "severity", label: "minor", answer: { choice: "minor", confidence: 0.4 } },
        { question: "severity", label: "info" },
        { question: "mainlyAffected", label: ["pedestrians", "cyclists"], answer: { choice: "cyclists", confidence: 0.75 } },
      ],
      0.7,
    );

    expect(result.severity).toEqual({ labelled: 4, answered: 3, correct: 2, accepted: 2, acceptedCorrect: 1 });
    expect(result.mainlyAffected).toEqual({ labelled: 1, answered: 1, correct: 1, accepted: 1, acceptedCorrect: 1 });
  });

  it("skips unlabelled answers, which aren't graded", () => {
    const result = score([{ question: "workType", label: null, answer: { choice: "paving", confidence: 1 } }], 0.7);

    expect(result.workType).toBeUndefined();
  });

  it("counts an answer at exactly the threshold as accepted", () => {
    const result = score([{ question: "endDate", label: "2026-11-13", answer: { choice: "2026-11-13", confidence: 0.7 } }], 0.7);

    expect(result.endDate).toMatchObject({ accepted: 1, acceptedCorrect: 1 });
  });
});
