import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";

// Applies pending migrations from apps/api/drizzle (made with `pnpm --filter @pulse/api db:generate`).
// Node-only: never imported by the HTTP layer.

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle({ client: pool }), { migrationsFolder });
}
