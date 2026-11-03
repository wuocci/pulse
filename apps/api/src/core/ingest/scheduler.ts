import type { Event } from "@pulse/schema";
import { fetchAlerts as fetchCapAlerts, toEvents as toWeatherEvents } from "../adapters/cap.ts";
import { type Directory, fetchAlerts, idsToLook, type StopDirectory, toEvents } from "../adapters/gtfs-rt.ts";
import { fetchMessages, toEvents as toRoadEvents } from "../adapters/digitraffic.ts";
import { toEvents as toHandKeptEvents } from "../adapters/hand-kept.ts";
import { fetchPermits, toPermitItems } from "../adapters/land-use-permits.ts";
import { fetchEvents, toEvents as toCalendarEvents } from "../adapters/linked-events.ts";
import type { Classification } from "../classifier/enrich.ts";
import type { EventStore } from "../events/store.ts";
import type { GtfsRtSource, Region, SourceConfig } from "../regions/index.ts";
import type { SourceHealthLog } from "./health.ts";
import { keepVanished } from "./vanished.ts";

export interface IngestOptions {
  fetchFn?: typeof fetch;
  // Without it, permit Events are published as their Adapter made them.
  classification?: Classification;
  // A GTFS-RT Source's stop directory. Without it, alerts are placed vaguely in the Region.
  stopDirectory?: (source: GtfsRtSource) => StopDirectory;
  // Where each refresh's outcome is kept, for /v0/sources/health.
  health?: SourceHealthLog;
}

// Temporary scheduler until pg-boss jobs land (#2): refreshes every Source of every Region on its own interval.
// Returns a function that stops all timers.
export function startIngest(regions: Region[], store: EventStore, options: IngestOptions = {}): () => void {
  const timers = regions.flatMap((region) =>
    region.sources.map((source) => {
      const refresh = () => refreshSource(source, region, store, options);
      void refresh();
      return setInterval(refresh, source.refreshMinutes * 60_000);
    }),
  );
  return () => timers.forEach(clearInterval);
}

export async function refreshSource(source: SourceConfig, region: Region, store: EventStore, options: IngestOptions = {}) {
  try {
    const now = new Date();
    const previous = await store.sourceEvents(source.id);
    const fresh = await read(source, region, options, now, previous);
    const events = source.keepVanishedHours
      ? keepVanished(previous, fresh.events, { now, keepForHours: source.keepVanishedHours })
      : fresh.events;
    await store.replaceSource(source.id, events);
    options.health?.succeeded(source.id, new Date());
    console.log(`${region.id}/${source.id}: ${events.length} Events`);
    // In the background: the next refresh doesn't wait for it.
    void fresh.classifyRest?.();
  } catch (error) {
    console.error(`${region.id}/${source.id}: refresh failed:`, error);
    options.health?.failed(source.id, new Date(), error instanceof Error ? error.message : String(error));
  }
}

const NO_DIRECTORY: Directory = { stops: new Map(), routes: new Map() };

// One Source's Events through its Adapter (ADR 0002), and the Classifier's background pass if it has one.
async function read(
  source: SourceConfig,
  region: Region,
  { fetchFn = fetch, classification, stopDirectory }: IngestOptions,
  now: Date,
  previous: Event[],
): Promise<{ events: Event[]; classifyRest?: () => Promise<void> }> {
  switch (source.adapter) {
    case "land-use-permits": {
      const items = toPermitItems(await fetchPermits(source, fetchFn), { source, timeZone: region.timeZone, now });
      if (!classification) return { events: items.map((item) => item.event) };
      return classification.prepare(source, items, { timeZone: region.timeZone, now });
    }
    case "gtfs-rt": {
      const alerts = await fetchAlerts(source, fetchFn);
      const directory = stopDirectory ? await stopDirectory(source).lookup(idsToLook(alerts, source)) : NO_DIRECTORY;
      return { events: toEvents(alerts, directory, { source, region, now }) };
    }
    case "digitraffic":
      return { events: toRoadEvents(await fetchMessages(source, fetchFn), { source, region, now }) };
    case "cap":
      return { events: toWeatherEvents(await fetchCapAlerts(source, fetchFn), { source, region, now, previous }) };
    case "hand-kept":
      return { events: toHandKeptEvents(source, now) };
    case "linked-events": {
      const context = { source, region, now };
      return { events: toCalendarEvents(await fetchEvents(context, fetchFn), context) };
    }
  }
}
