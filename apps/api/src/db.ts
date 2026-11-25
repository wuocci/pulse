import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";

// Applies pending migrations from apps/api/drizzle (made with `pnpm --filter @pulse/api db:generate`).
// Node-only: never imported by the HTTP layer.

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

// Any fixed number: the API and the ingest process both migrate at startup, and this lock makes them take turns.
const MIGRATION_LOCK = 7_204_001;

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}
