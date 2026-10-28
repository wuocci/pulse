import { type Event, MainlyAffectedSchema, SeveritySchema, WorkTypeSchema } from "@pulse/schema";
import { localTime } from "../adapters/land-use-permits.ts";

// The Classifier (CONTEXT.md, ADR 0003): typed choices about a Source's free text, once per text, at ingest.
// It only chooses: code builds the choices (including any dates found in the text), so it can never invent a value.
// Raw answers and confidences stay inside core; the Event carries only the accepted values.

// What the Classifier reads about one Event, as named fields.
export type ClassifierState = Record<string, string | number>;

export const QUESTION_IDS = ["workType", "endDate", "severity", "mainlyAffected"] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

// One typed choice. The keys of `choices` are the only valid answers; values describe them, or are null.
export interface ChoiceQuestion {
  prompt: string;
  choices: Record<string, string | null>;
}

export type Questions = Partial<Record<QuestionId, ChoiceQuestion>>;

export interface Answer {
  choice: string;
  confidence: number;
}

export type Answers = Partial<Record<QuestionId, Answer>>;

// Jev is the first implementation.
export interface Classifier {
  // Part of the cache key: another model's answers are never reused.
  readonly model: string;
  classify(state: ClassifierState, questions: Questions): Promise<Answers>;
}

// Answers below this confidence don't count. The server's config may override it.
// 0.6 after grading against the answer key (pnpm --filter @pulse/api eval:classifier): over three runs it accepted
// about 46 of 75 graded answers with 91–93% right, against about 36 with 94% at 0.7.
export const DEFAULT_THRESHOLD = 0.6;

// The answer to the end date question when the text gives no end date.
export const NOT_STATED = "not_stated";

export interface ApplyOptions {
  threshold: number;
  // The Region's time zone, for an end date taken from the text.
  timeZone: string;
  // Month-days (MM-DD) the Source's own rules put in the end date field rather than the work's end,
  // so a different date in the text is no conflict.
  ruleEndDays?: string[];
}

// Applies the Classifier's answers to an Event as its Adapter made it, i.e. still carrying the defaults.
// An answer counts only when it is one of its question's choices and its confidence reaches the threshold;
// otherwise the default stays. The Event's confidence is the lowest among the answers that counted or,
// if none did, the highest raw confidence (below the threshold, so it never pushes). No answers: 0.
export function applyAnswers(event: Event, questions: Questions, answers: Answers, { threshold, timeZone, ruleEndDays = [] }: ApplyOptions): Event {
  const valid = QUESTION_IDS.flatMap((id) => {
    const answer = answers[id];
    const question = questions[id];
    if (!answer || !question || !Object.hasOwn(question.choices, answer.choice)) return [];
    if (!(answer.confidence >= 0 && answer.confidence <= 1)) return [];
    return [{ id, ...answer }];
  });
  const counted = valid.filter((a) => a.confidence >= threshold);

  const next: Event = { ...event, when: { ...event.when } };
  for (const { id, choice } of counted) {
    if (id === "severity") next.severity = SeveritySchema.parse(choice);
    if (id === "mainlyAffected") next.mainlyAffected = MainlyAffectedSchema.parse(choice);
    if (id === "workType") next.workType = WorkTypeSchema.parse(choice);
    if (id === "endDate") {
      // `when.end` keeps the Source's structured date; the text's date only flags the conflict.
      // With no structured date, the text's date becomes the end, to the end of that local day as Adapters do.
      const field = event.when.end?.slice(0, 10);
      if (choice === NOT_STATED) continue;
      if (!field) next.when.end = localTime(choice, "23:59:59", timeZone);
      else if (choice !== field && !ruleEndDays.includes(field.slice(5))) next.when.endConflict = { field, text: choice };
    }
  }

  const confidences = (counted.length ? counted : valid).map((a) => a.confidence);
  next.confidence = counted.length ? Math.min(...confidences) : Math.max(0, ...confidences);
  return next;
}
