import type { CarParkReading } from "../adapters/digitransit-parking.ts";
import type { CarParkOccupancySource, Region } from "../regions/index.ts";
import { BUCKET_MS } from "./recorder.ts";

// Records car park occupancy as 5-minute Conditions (#50): free spaces and capacity per facility, read once per
// bucket. Baselines per facility, weekday and hour are computed from these rows once weeks are recorded.

export type { CarParkReading };

// One 5-minute Condition row for one car park.
export interface CarParkOccupancy extends CarParkReading {
  bucket: Date;
}

export interface OccupancyReader {
  read(): Promise<CarParkReading[]>;
}

export interface OccupancyStore {
  insertCarParkOccupancy(sourceId: string, rows: CarParkOccupancy[]): Promise<void>;
}

// Read this long after a bucket starts, so the Source has had time to refresh its counts.
const READ_OFFSET_MS = 30_000;

export interface OccupancyRecorderOptions {
  sourceId: string;
  reader: OccupancyReader;
  store: OccupancyStore;
  now?: () => Date;
  // False turns the timer off; read() can still be called directly.
  schedule?: boolean;
}

export interface OccupancyRecorder {
  // Reads and writes the current bucket, unless it already has been. Resolves when the write has finished.
  read(): Promise<void>;
  stop(): void;
}

// A failed read or write leaves the bucket empty: a gap, never zeros.
export function startOccupancyRecorder({ sourceId, reader, store, now = () => new Date(), schedule = true }: OccupancyRecorderOptions): OccupancyRecorder {
  let lastBucket = Number.NEGATIVE_INFINITY;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const read = async () => {
    const bucket = Math.floor(now().getTime() / BUCKET_MS) * BUCKET_MS;
    if (bucket <= lastBucket) return;
    lastBucket = bucket;
    try {
      const readings = await reader.read();
      // A read that took into the next bucket says nothing sure about this one.
      if (Math.floor(now().getTime() / BUCKET_MS) * BUCKET_MS !== bucket) throw new Error("the read took past its 5-minute bucket");
      if (readings.length === 0) return;
      await store.insertCarParkOccupancy(sourceId, readings.map((r) => ({ ...r, bucket: new Date(bucket) })));
      console.log(`${sourceId}: ${readings.length} Conditions for ${new Date(bucket).toISOString()}`);
    } catch (error) {
      console.error(`${sourceId}: recording occupancy failed:`, error instanceof Error ? error.message : error);
    }
  };

  const next = () => {
    if (stopped) return;
    const time = now().getTime();
    const at = Math.floor((time - READ_OFFSET_MS) / BUCKET_MS) * BUCKET_MS + BUCKET_MS + READ_OFFSET_MS;
    timer = setTimeout(() => void read().finally(next), at - time);
  };
  if (schedule) void read().finally(next);

  return {
    read,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

// Starts a recorder for every car park occupancy Source of every Region. `open` gives null when the Source can't
// be read (no API key), and that Source is skipped. Returns a function that stops them all.
export function startOccupancyIngest(
  regions: Region[],
  store: OccupancyStore,
  open: (source: CarParkOccupancySource, region: Region) => OccupancyReader | null,
): () => void {
  const recorders = regions.flatMap((region) =>
    (region.conditionSources ?? []).flatMap((source) => {
      if (source.adapter !== "digitransit-parking") return [];
      const reader = open(source, region);
      if (!reader) return [];
      return [startOccupancyRecorder({ sourceId: source.id, reader, store })];
    }),
  );
  return () => recorders.forEach((r) => r.stop());
}
