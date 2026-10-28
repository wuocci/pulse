import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createPool } from "./config.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import { startIngest } from "./core/ingest/scheduler.ts";
import { regions } from "./core/regions/index.ts";
import { runMigrations } from "./db.ts";

const pool = createPool();

// Migrations run before anything uses the database. An unreachable database doesn't stop the API:
// it still serves Events, and /health reports the database as down.
await runMigrations(pool).catch((error: unknown) =>
  console.error("Database migrations failed:", error instanceof Error ? error.message : error),
);

const events = new InMemoryEventStore();
const stopIngest = startIngest(regions, events);

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
