import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { integer, pgTable, primaryKey, real, smallint, text, timestamp } from "drizzle-orm/pg-core";
import type pg from "pg";
import type { ConditionStore, LineDelay } from "./recorder.ts";

// 5-minute delay Conditions per transit line and direction. A TimescaleDB hypertable on `bucket`
// (see the migrations in apps/api/drizzle); old rows are dropped by a retention policy.
export const transitLineConditions = pgTable(
  "transit_line_conditions",
  {
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    sourceId: text("source_id").notNull(),
    line: text("line").notNull(),
    direction: smallint("direction").notNull(),
    avgDelayS: real("avg_delay_s").notNull(),
    p90DelayS: real("p90_delay_s").notNull(),
    vehicleCount: integer("vehicle_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.line, t.direction, t.bucket] })],
);

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export class PgConditionStore implements ConditionStore {
  private db;

  constructor(private pool: pg.Pool) {
    this.db = drizzle({ client: pool });
  }

  // Applies pending migrations and sets how long raw 5-minute rows are kept.
  async prepare(retentionDays: number) {
    await migrate(this.db, { migrationsFolder });
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select remove_retention_policy('transit_line_conditions', if_exists => true)");
      await client.query("select add_retention_policy('transit_line_conditions', make_interval(days => $1::int))", [
        retentionDays,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async insertLineDelays(sourceId: string, rows: LineDelay[]) {
    await this.db
      .insert(transitLineConditions)
      .values(rows.map((row) => ({ ...row, sourceId })))
      .onConflictDoNothing();
  }
}
