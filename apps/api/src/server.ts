import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { classifierConfig, createPool } from "./config.ts";
import { PgAnswerCache } from "./core/classifier/cache.ts";
import { Classification } from "./core/classifier/enrich.ts";
import { createJevClassifier } from "./core/classifier/jev.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import { startIngest } from "./core/ingest/scheduler.ts";
import { regions } from "./core/regions/index.ts";
import { runMigrations } from "./db.ts";

const pool = createPool();

// Migrations run before anything uses the database. An unreachable database doesn't stop the API:
// it still serves Events, and /health reports the database as down.
const migrated = await runMigrations(pool).then(
  () => true,
  (error: unknown) => {
    console.error("Database migrations failed:", error instanceof Error ? error.message : error);
    return false;
  },
);

const events = new InMemoryEventStore();

// Classification needs the answer cache: without it, every restart would ask the Classifier about every text again.
const classifier = classifierConfig();
const classification =
  classifier && migrated
    ? new Classification({
        classifier: createJevClassifier(classifier),
        cache: new PgAnswerCache(pool),
        store: events,
        threshold: classifier.threshold,
      })
    : undefined;
if (!classifier) console.log("Classifier off: TYPESAFE_API_KEY not set");
else if (!classification) console.log("Classifier off: no database for its cache");
else console.log(`Classifier on: ${classifier.model}, threshold ${classifier.threshold}`);

const stopIngest = startIngest(regions, events, { classification });

const app = createApp({
  db: {
    async ping() {
      await pool.query("select 1");
      return true;
    },
  },
  events,
  regions,
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Pulse API listening on http://localhost:${info.port}/v0`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopIngest();
    server.close();
    void pool.end().then(() => process.exit(0));
  });
}
