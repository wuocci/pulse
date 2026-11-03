import type { z } from "@hono/zod-openapi";
import type { SourceStatusSchema } from "@pulse/schema";
import type { SourceConfig } from "../regions/index.ts";

// How each Source's refreshes went: the last success, the last error, and how many failed in a row since.

export interface SourceHealthLog {
  succeeded(sourceId: string, at: Date): void;
  failed(sourceId: string, at: Date, message: string): void;
  of(sourceId: string): SourceRecord | undefined;
}

export interface SourceRecord {
  lastSuccessAt?: Date;
  lastError?: { at: Date; message: string };
  failuresInARow: number;
}

// Until Postgres lands (#2), ingest runs in the API's process: the log lives in memory, and starts empty on restart.
export class InMemorySourceHealthLog implements SourceHealthLog {
  private bySource = new Map<string, SourceRecord>();

  succeeded(sourceId: string, at: Date) {
    this.bySource.set(sourceId, { ...this.bySource.get(sourceId), lastSuccessAt: at, failuresInARow: 0 });
  }

  failed(sourceId: string, at: Date, message: string) {
    const record = this.bySource.get(sourceId);
    this.bySource.set(sourceId, { ...record, lastError: { at, message }, failuresInARow: (record?.failuresInARow ?? 0) + 1 });
  }

  of(sourceId: string) {
    return this.bySource.get(sourceId);
  }
}

// This many failed refreshes in a row and a Source is down, not just late.
export const DOWN_AFTER_FAILURES = 3;
// A refresh takes a while: a Source is late only once its interval and this much more have gone by.
const GRACE_MS = 60_000;

export function statusOf(source: Pick<SourceConfig, "refreshMinutes">, record: SourceRecord | undefined, now: Date): z.infer<typeof SourceStatusSchema> {
  if (record && record.failuresInARow >= DOWN_AFTER_FAILURES) return "down";
  const since = record?.lastSuccessAt;
  return since && now.getTime() - since.getTime() <= source.refreshMinutes * 60_000 + GRACE_MS ? "ok" : "delayed";
}
