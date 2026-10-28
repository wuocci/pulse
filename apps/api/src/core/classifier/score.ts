import type { Answer, QuestionId } from "./classifier.ts";

// Grades the Classifier's answers against the hand-labelled answer key (fixtures/answer-key.json).
// A label is the right choice, a list of equally right choices, or null when the labeller left it ungraded.

export type Label = string | string[] | null;

export interface Graded {
  question: QuestionId;
  label: Label;
  // Missing when the Classifier wasn't asked or gave no answer.
  answer?: Answer;
}

export interface QuestionScore {
  // Graded answers: the label isn't null.
  labelled: number;
  answered: number;
  // The Classifier's choice was right, whatever its confidence.
  correct: number;
  // Reached the threshold, so it would land on the Event.
  accepted: number;
  acceptedCorrect: number;
}

export function isCorrect(label: string | string[], choice: string): boolean {
  return Array.isArray(label) ? label.includes(choice) : label === choice;
}

export function score(graded: Graded[], threshold: number): Partial<Record<QuestionId, QuestionScore>> {
  const result: Partial<Record<QuestionId, QuestionScore>> = {};
  for (const { question, label, answer } of graded) {
    if (label === null) continue;
    const s = (result[question] ??= { labelled: 0, answered: 0, correct: 0, accepted: 0, acceptedCorrect: 0 });
    s.labelled++;
    if (!answer) continue;
    const right = isCorrect(label, answer.choice);
    s.answered++;
    if (right) s.correct++;
    if (answer.confidence >= threshold) {
      s.accepted++;
      if (right) s.acceptedCorrect++;
    }
  }
  return result;
}
