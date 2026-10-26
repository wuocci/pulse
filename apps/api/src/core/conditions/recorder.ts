import type { ConditionSourceConfig, Region } from "../regions/index.ts";

// Records transit line delays as 5-minute Conditions (CONTEXT.md). A realtime stream is aggregated in memory
// and only the 5-minute rows are stored, never individual vehicle messages (ADR 0008).

export const BUCKET_MS = 5 * 60_000;

// One vehicle's delay at one moment. Positive means late.
export interface DelaySample {
  line: string;
  direction: number;
  vehicle: string;
  delayS: number;
  at: Date;
}

// One 5-minute Condition row for a line and direction. Vehicles are averaged first, so a vehicle that reports
// more often doesn't weigh more.
export interface LineDelay {
  bucket: Date;
  line: string;
  direction: number;
  avgDelayS: number;
  p90DelayS: number;
  vehicleCount: number;
}

export interface DelayListener {
  sample(sample: DelaySample): void;
  connected(): void;
  disconnected(): void;
}

// A long-running reader of one Source's realtime delays. `start` returns a function that stops it.
// Implementations reconnect on their own and report each connect and disconnect.
export interface DelayStream {
  start(listener: DelayListener): () => void;
}

export interface ConditionStore {
  insertLineDelays(sourceId: string, rows: LineDelay[]): Promise<void>;
}

interface Running {
  sum: number;
  count: number;
}

export class DelayAggregator {
  // bucket start (ms) → "line|direction" → vehicle → running sum of its delays
  private buckets = new Map<number, Map<string, Map<string, Running>>>();
  private acceptFrom = Number.POSITIVE_INFINITY;
  private vehicles = 0;
  private readonly graceMs: number;
  private readonly maxVehicles: number;

  // graceMs: how long a bucket stays open after it ends, for late messages.
  // maxVehicles: cap on vehicle entries across open buckets, so memory stays flat whatever the stream does.
  constructor({ graceMs = 30_000, maxVehicles = 20_000 }: { graceMs?: number; maxVehicles?: number } = {}) {
    this.graceMs = graceMs;
    this.maxVehicles = maxVehicles;
  }

  // Vehicle entries held in memory.
  get size() {
    return this.vehicles;
  }

  // Forgets open buckets and accepts samples only from the next bucket boundary, because the bucket in progress
  // would be partial. Call on every connect and disconnect, so an outage shows up as missing rows.
  restart(now: Date) {
    this.buckets.clear();
    this.vehicles = 0;
    this.acceptFrom = Math.ceil(now.getTime() / BUCKET_MS) * BUCKET_MS;
  }

  // Returns false when the sample was dropped.
  add({ line, direction, vehicle, delayS, at }: DelaySample): boolean {
    const time = at.getTime();
    if (!(time >= this.acceptFrom) || !Number.isFinite(delayS)) return false;
    const start = Math.floor(time / BUCKET_MS) * BUCKET_MS;

    let lines = this.buckets.get(start);
    if (!lines) this.buckets.set(start, (lines = new Map()));
    const key = `${line}|${direction}`;
    let byVehicle = lines.get(key);
    if (!byVehicle) lines.set(key, (byVehicle = new Map()));
    let running = byVehicle.get(vehicle);
    if (!running) {
      if (this.vehicles >= this.maxVehicles) return false;
      byVehicle.set(vehicle, (running = { sum: 0, count: 0 }));
      this.vehicles++;
    }
    running.sum += delayS;
    running.count++;
    return true;
  }

  // Emits and forgets every bucket that ended at least graceMs before now. Later samples for it are dropped.
  flush(now: Date, graceMs = this.graceMs): LineDelay[] {
    const rows: LineDelay[] = [];
    for (const [start, lines] of [...this.buckets].sort(([a], [b]) => a - b)) {
      if (start + BUCKET_MS + graceMs > now.getTime()) continue;
      for (const [key, byVehicle] of lines) {
        const [line = "", direction] = key.split("|");
        const delays = [...byVehicle.values()].map((r) => r.sum / r.count).sort((a, b) => a - b);
        const avg = delays.reduce((sum, d) => sum + d, 0) / delays.length;
        // Nearest-rank percentile
        const p90 = delays[Math.ceil(0.9 * delays.length) - 1] ?? avg;
        rows.push({
          bucket: new Date(start),
          line,
          direction: Number(direction),
          avgDelayS: round(avg),
          p90DelayS: round(p90),
          vehicleCount: delays.length,
        });
        this.vehicles -= byVehicle.size;
      }
      this.buckets.delete(start);
      this.acceptFrom = Math.max(this.acceptFrom, start + BUCKET_MS);
    }
    return rows.sort(
      (a, b) => a.bucket.getTime() - b.bucket.getTime() || a.line.localeCompare(b.line) || a.direction - b.direction,
    );
  }
}

const round = (seconds: number) => Math.round(seconds * 10) / 10;

export interface RecorderOptions {
  sourceId: string;
  stream: DelayStream;
  store: ConditionStore;
  now?: () => Date;
  // 0 turns the timer off; flush() can still be called directly.
  flushEveryMs?: number;
  aggregator?: DelayAggregator;
}

export interface Recorder {
  // Writes every bucket that is due. Resolves when all writes so far have finished.
  flush(): Promise<void>;
  stop(): void;
}

export function startDelayRecorder({
  sourceId,
  stream,
  store,
  now = () => new Date(),
  flushEveryMs = 15_000,
  aggregator = new DelayAggregator(),
}: RecorderOptions): Recorder {
  let writes = Promise.resolve();
  const write = (rows: LineDelay[]) => {
    if (rows.length === 0) return writes;
    writes = writes.then(() =>
      store.insertLineDelays(sourceId, rows).then(
        () => console.log(`${sourceId}: ${rows.length} Conditions for ${rows[0]?.bucket.toISOString()}`),
        // A failed write leaves a gap, like an outage does.
        (error: unknown) => console.error(`${sourceId}: writing Conditions failed:`, error),
      ),
    );
    return writes;
  };

  aggregator.restart(now());
  const stopStream = stream.start({
    sample: (sample) => void aggregator.add(sample),
    connected: () => aggregator.restart(now()),
    disconnected: () => {
      // Buckets that already ended are complete; the one in progress is not.
      void write(aggregator.flush(now(), 0));
      aggregator.restart(now());
    },
  });
  const flush = () => write(aggregator.flush(now()));
  const timer = flushEveryMs > 0 ? setInterval(() => void flush(), flushEveryMs) : undefined;

  return {
    flush,
    stop() {
      clearInterval(timer);
      stopStream();
    },
  };
}

// Starts a recorder for every Condition Source of every Region. Returns a function that stops them all.
export function startConditionIngest(
  regions: Region[],
  store: ConditionStore,
  openStream: (source: ConditionSourceConfig) => DelayStream,
): () => void {
  const recorders = regions.flatMap((region) =>
    (region.conditionSources ?? []).map((source) =>
      startDelayRecorder({ sourceId: source.id, stream: openStream(source), store }),
    ),
  );
  return () => recorders.forEach((r) => r.stop());
}
