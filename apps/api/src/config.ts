import pg from "pg";
import { DEFAULT_THRESHOLD } from "./core/classifier/classifier.ts";

// Process config for the server entrypoint. Node-only: never imported by the HTTP layer.

type Env = Record<string, string | undefined>;

export interface ClassifierConfig {
  apiKey: string;
  // Pinned in production (.env.production) so a new Jev release can't change classifications silently.
  model: string;
  // Answers below this confidence don't count.
  threshold: number;
}

// The Classifier's config, or null without TYPESAFE_API_KEY: then nothing is classified and Events publish
// unclassified (confidence 0). A bad threshold fails fast at startup.
export function classifierConfig(env: Env = process.env): ClassifierConfig | null {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return null;
  const raw = env.CLASSIFIER_THRESHOLD?.trim() || String(DEFAULT_THRESHOLD);
  const threshold = Number(raw);
  if (!(threshold > 0 && threshold <= 1)) throw new Error(`CLASSIFIER_THRESHOLD must be in (0, 1], got "${raw}"`);
  return { apiKey, model: env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest", threshold };
}

// The key for Digitransit, where GTFS-RT Sources look up their stops and routes. Without it, alerts are placed
// vaguely in the Region.
export function digitransitApiKey(env: Env = process.env): string | null {
  return env.DIGITRANSIT_API_KEY?.trim() || null;
}

// The Postgres pool. Errors on idle clients (e.g. the database restarting) are logged, not thrown:
// without a listener they would crash the process. The pool replaces broken clients on the next query.
export function createPool(env: Env = process.env): pg.Pool {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL ?? "postgres://pulse:pulse@localhost:5432/pulse",
    connectionTimeoutMillis: 2_000,
  });
  pool.on("error", (error) => console.error("Postgres client error:", error.message));
  return pool;
}
