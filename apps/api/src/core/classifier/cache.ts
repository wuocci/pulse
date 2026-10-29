import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type pg from "pg";
import type { Answers, ClassifierState } from "./classifier.ts";
import { QUESTION_VERSION } from "./questions.ts";

// The Classifier's raw answers, once per text (ADR 0003). The same rows are the evidence for tuning the threshold,
// so they keep every answer and its confidence, not only the accepted ones.
// Bumping QUESTION_VERSION or changing the model starts a fresh set of keys; old rows stay as evidence.

export const classifierAnswers = pgTable(
  "classifier_answers",
  {
    stateHash: text("state_hash").notNull(),
    questionVersion: integer("question_version").notNull(),
    model: text("model").notNull(),
    answers: jsonb("answers").$type<Answers>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.stateHash, t.questionVersion, t.model] })],
);

export interface CacheKey {
  // SHA-256 of everything the Classifier reads about the Event: its text and the Adapter's facts.
  stateHash: string;
  questionVersion: number;
  model: string;
}

export function cacheKey(state: ClassifierState, model: string): CacheKey {
  const canonical = JSON.stringify(Object.entries(state).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { stateHash: createHash("sha256").update(canonical).digest("hex"), questionVersion: QUESTION_VERSION, model };
}

export interface AnswerCache {
  // The cached answers for the given state hashes under one question version and model, by hash.
  getMany(stateHashes: string[], questionVersion: number, model: string): Promise<Map<string, Answers>>;
  put(key: CacheKey, answers: Answers): Promise<void>;
}

export class PgAnswerCache implements AnswerCache {
  private db;

  constructor(pool: pg.Pool) {
    this.db = drizzle({ client: pool });
  }

  async getMany(stateHashes: string[], questionVersion: number, model: string) {
    if (!stateHashes.length) return new Map<string, Answers>();
    const rows = await this.db
      .select({ stateHash: classifierAnswers.stateHash, answers: classifierAnswers.answers })
      .from(classifierAnswers)
      .where(
        and(
          inArray(classifierAnswers.stateHash, stateHashes),
          eq(classifierAnswers.questionVersion, questionVersion),
          eq(classifierAnswers.model, model),
        ),
      );
    return new Map(rows.map((row) => [row.stateHash, row.answers]));
  }

  // Answers for a key never change, so a second write of the same key is a no-op.
  async put(key: CacheKey, answers: Answers) {
    await this.db
      .insert(classifierAnswers)
      .values({ ...key, answers })
      .onConflictDoNothing();
  }
}
