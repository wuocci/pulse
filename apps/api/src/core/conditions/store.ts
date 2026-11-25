import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, primaryKey, real, smallint, text, timestamp } from "drizzle-orm/pg-core";
import type pg from "pg";
import { runMigrations } from "../../db.ts";
import type { CarParkOccupancy, OccupancyStore } from "./occupancy.ts";
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

// 5-minute occupancy Conditions per car park (#50): free spaces and capacity as read. A hypertable on `bucket` too.
export const carParkConditions = pgTable(
  "car_park_conditions",
  {
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    sourceId: text("source_id").notNull(),
    facility: text("facility").notNull(),
    freeSpaces: integer("free_spaces").notNull(),
    capacity: integer("capacity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.facility, t.bucket] })],
);

// The hypertables, each with the same retention.
const HYPERTABLES = ["transit_line_conditions", "car_park_conditions"];

export class PgConditionStore implements ConditionStore, OccupancyStore {
  private db;

  constructor(private pool: pg.Pool) {
    this.db = drizzle({ client: pool });
  }

  // Applies pending migrations and sets how long raw 5-minute rows are kept.
  async prepare(retentionDays: number) {
    await runMigrations(this.pool);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const table of HYPERTABLES) {
        await client.query("select remove_retention_policy($1::regclass, if_exists => true)", [table]);
        await client.query("select add_retention_policy($1::regclass, make_interval(days => $2::int))", [table, retentionDays]);
      }
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

  async insertCarParkOccupancy(sourceId: string, rows: CarParkOccupancy[]) {
    await this.db
      .insert(carParkConditions)
      .values(rows.map((row) => ({ ...row, sourceId })))
      .onConflictDoNothing();
  }
}
