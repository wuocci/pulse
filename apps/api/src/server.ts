import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import { startIngest } from "./core/ingest/scheduler.ts";
import { regions } from "./core/regions/index.ts";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://pulse:pulse@localhost:5432/pulse",
  connectionTimeoutMillis: 2000,
});

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
