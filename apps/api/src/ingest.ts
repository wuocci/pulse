import pg from "pg";
import { hfpStream } from "./core/adapters/hfp.ts";
import { startConditionIngest } from "./core/conditions/recorder.ts";
import { PgConditionStore } from "./core/conditions/store.ts";
import { retryWithBackoff } from "./core/ingest/retry.ts";
import { regions } from "./core/regions/index.ts";

// The ingest process (ADR 0010): long-running Source readers, separate from the HTTP server.
// Permit polling (startIngest) moves here once Events live in Postgres; until then the API process runs it.

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://pulse:pulse@localhost:5432/pulse",
  connectionTimeoutMillis: 5_000,
});

// Raw 5-minute Conditions are kept this long; Baselines are computed from them.
const retentionDays = Number(process.env.CONDITION_RETENTION_DAYS ?? 90);
const conditions = new PgConditionStore(pool);

let stop = () => {};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop();
    void pool.end().then(() => process.exit(0));
  });
}

await retryWithBackoff(() => conditions.prepare(retentionDays), {
  onRetry: (error, waitMs) =>
    console.error(`Database not ready, retrying in ${waitMs / 1000} s:`, error instanceof Error ? error.message : error),
});
console.log(`Ingest started; Conditions kept ${retentionDays} days`);
stop = startConditionIngest(regions, conditions, hfpStream);
