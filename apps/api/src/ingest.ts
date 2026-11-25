import { conditionRetentionDays, createPool, digitransitApiKey } from "./config.ts";
import { digitransitOccupancy } from "./core/adapters/digitransit-parking.ts";
import { hfpStream } from "./core/adapters/hfp.ts";
import { startOccupancyIngest } from "./core/conditions/occupancy.ts";
import { startConditionIngest } from "./core/conditions/recorder.ts";
import { PgConditionStore } from "./core/conditions/store.ts";
import { retryWithBackoff } from "./core/ingest/retry.ts";
import { regions } from "./core/regions/index.ts";

// The ingest process (ADR 0010): long-running Source readers, separate from the HTTP server.
// Permit polling (startIngest) moves here once Events live in Postgres; until then the API process runs it.

// Config errors fail fast here; only an unreachable database is retried below.
// Raw 5-minute Conditions are kept this long; Baselines are computed from them.
const retentionDays = conditionRetentionDays();
const pool = createPool();
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
const digitransitKey = digitransitApiKey();
if (!digitransitKey) console.log("Car park occupancy off: DIGITRANSIT_API_KEY not set");
const stopDelays = startConditionIngest(regions, conditions, hfpStream);
const stopOccupancy = startOccupancyIngest(regions, conditions, (source, region) =>
  digitransitKey ? digitransitOccupancy({ url: source.url, apiKey: digitransitKey, bbox: region.bbox }) : null,
);
stop = () => {
  stopDelays();
  stopOccupancy();
};
