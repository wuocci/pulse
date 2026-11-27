import type { Routine, RoutineInput } from "@pulse/schema";
import { and, eq, lt, notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { index, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import type pg from "pg";

// The app module's storage (ADR 0010, 0013): anonymous Devices and their Routines. Core tables never reference these.

// Routines the app hasn't renewed for this long are deleted, and so are Devices left with none (ADR 0013).
export const STALE_AFTER_MS = 60 * 86_400_000;

export interface AppStore {
  createDevice(now: Date): Promise<string>;
  hasDevice(deviceId: string): Promise<boolean>;
  listRoutines(deviceId: string): Promise<Routine[]>;
  createRoutine(deviceId: string, input: RoutineInput, now: Date): Promise<Routine>;
  // Undefined when the Device has no such Routine.
  updateRoutine(deviceId: string, id: string, input: RoutineInput, now: Date): Promise<Routine | undefined>;
  deleteRoutine(deviceId: string, id: string): Promise<boolean>;
  // The app is in use: its Device and every Routine of it are renewed.
  renew(deviceId: string, now: Date): Promise<void>;
  // Deletes what hasn't been renewed since `before`; returns how many Routines went.
  deleteStale(before: Date): Promise<number>;
}

interface StoredDevice {
  lastSeenAt: Date;
  routines: Map<string, Routine>;
}

export class InMemoryAppStore implements AppStore {
  private devices = new Map<string, StoredDevice>();

  async createDevice(now: Date) {
    const id = crypto.randomUUID();
    this.devices.set(id, { lastSeenAt: now, routines: new Map() });
    return id;
  }

  async hasDevice(deviceId: string) {
    return this.devices.has(deviceId);
  }

  async listRoutines(deviceId: string) {
    return [...(this.devices.get(deviceId)?.routines.values() ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createRoutine(deviceId: string, input: RoutineInput, now: Date) {
    const device = this.device(deviceId);
    const at = now.toISOString();
    const routine: Routine = { ...input, id: crypto.randomUUID(), createdAt: at, renewedAt: at };
    device.routines.set(routine.id, routine);
    return routine;
  }

  async updateRoutine(deviceId: string, id: string, input: RoutineInput, now: Date) {
    const routines = this.devices.get(deviceId)?.routines;
    const old = routines?.get(id);
    if (!routines || !old) return undefined;
    const routine: Routine = { ...input, id, createdAt: old.createdAt, renewedAt: now.toISOString() };
    routines.set(id, routine);
    return routine;
  }

  async deleteRoutine(deviceId: string, id: string) {
    return this.devices.get(deviceId)?.routines.delete(id) ?? false;
  }

  async renew(deviceId: string, now: Date) {
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.lastSeenAt = now;
    for (const [id, routine] of device.routines) device.routines.set(id, { ...routine, renewedAt: now.toISOString() });
  }

  async deleteStale(before: Date) {
    let deleted = 0;
    for (const [deviceId, device] of this.devices) {
      for (const [id, routine] of device.routines) {
        if (Date.parse(routine.renewedAt) < before.getTime()) {
          device.routines.delete(id);
          deleted++;
        }
      }
      if (!device.routines.size && device.lastSeenAt < before) this.devices.delete(deviceId);
    }
    return deleted;
  }

  private device(deviceId: string) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`No Device ${deviceId}`);
    return device;
  }
}

export const appDevices = pgTable("app_devices", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});

// The Routine as the app sent it (RoutineInput) is kept whole in `data`: its shape is the schema's, not the table's.
export const appRoutines = pgTable(
  "app_routines",
  {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => appDevices.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<RoutineInput>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  renewedAt: timestamp("renewed_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("app_routines_device_id").on(t.deviceId)],
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toRoutine = (row: typeof appRoutines.$inferSelect): Routine => ({
  ...row.data,
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  renewedAt: row.renewedAt.toISOString(),
});

export class PgAppStore implements AppStore {
  private db;

  constructor(pool: pg.Pool) {
    this.db = drizzle({ client: pool });
  }

  async createDevice(now: Date) {
    const id = crypto.randomUUID();
    await this.db.insert(appDevices).values({ id, createdAt: now, lastSeenAt: now });
    return id;
  }

  async hasDevice(deviceId: string) {
    // Not a uuid can't be one; asking Postgres would be an error, not a miss.
    if (!UUID.test(deviceId)) return false;
    const rows = await this.db.select({ id: appDevices.id }).from(appDevices).where(eq(appDevices.id, deviceId)).limit(1);
    return rows.length > 0;
  }

  async listRoutines(deviceId: string) {
    const rows = await this.db.select().from(appRoutines).where(eq(appRoutines.deviceId, deviceId)).orderBy(appRoutines.createdAt);
    return rows.map(toRoutine);
  }

  async createRoutine(deviceId: string, input: RoutineInput, now: Date) {
    const [row] = await this.db.insert(appRoutines).values({ id: crypto.randomUUID(), deviceId, data: input, createdAt: now, renewedAt: now }).returning();
    return toRoutine(row!);
  }

  async updateRoutine(deviceId: string, id: string, input: RoutineInput, now: Date) {
    if (!UUID.test(id)) return undefined;
    const [row] = await this.db
      .update(appRoutines)
      .set({ data: input, renewedAt: now })
      .where(and(eq(appRoutines.id, id), eq(appRoutines.deviceId, deviceId)))
      .returning();
    return row && toRoutine(row);
  }

  async deleteRoutine(deviceId: string, id: string) {
    if (!UUID.test(id)) return false;
    const rows = await this.db
      .delete(appRoutines)
      .where(and(eq(appRoutines.id, id), eq(appRoutines.deviceId, deviceId)))
      .returning({ id: appRoutines.id });
    return rows.length > 0;
  }

  async renew(deviceId: string, now: Date) {
    await this.db.transaction(async (tx) => {
      await tx.update(appDevices).set({ lastSeenAt: now }).where(eq(appDevices.id, deviceId));
      await tx.update(appRoutines).set({ renewedAt: now }).where(eq(appRoutines.deviceId, deviceId));
    });
  }

  async deleteStale(before: Date) {
    return this.db.transaction(async (tx) => {
      const gone = await tx.delete(appRoutines).where(lt(appRoutines.renewedAt, before)).returning({ id: appRoutines.id });
      await tx
        .delete(appDevices)
        .where(
          and(
            lt(appDevices.lastSeenAt, before),
            notExists(tx.select({ one: sql`1` }).from(appRoutines).where(eq(appRoutines.deviceId, appDevices.id))),
          ),
        );
      return gone.length;
    });
  }
}
