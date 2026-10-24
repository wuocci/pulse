import type { Event } from "@pulse/schema";
import { fetchPermits, toEvents } from "../adapters/land-use-permits.ts";
import type { EventStore } from "../events/store.ts";
import type { Region, SourceConfig } from "../regions/index.ts";

type Adapter = (source: SourceConfig, region: Region, fetchFn: typeof fetch, now: Date) => Promise<Event[]>;

const adapters: Record<SourceConfig["adapter"], Adapter> = {
  "land-use-permits": async (source, region, fetchFn, now) =>
    toEvents(await fetchPermits(source, fetchFn), { source, timeZone: region.timeZone, now }),
};

// Temporary scheduler until pg-boss jobs land (#2): refreshes every Source of every Region on its own interval.
// Returns a function that stops all timers.
export function startIngest(regions: Region[], store: EventStore, fetchFn: typeof fetch = fetch): () => void {
  const timers = regions.flatMap((region) =>
    region.sources.map((source) => {
      const refresh = () => refreshSource(source, region, store, fetchFn);
      void refresh();
      return setInterval(refresh, source.refreshMinutes * 60_000);
    }),
  );
  return () => timers.forEach(clearInterval);
}

export async function refreshSource(source: SourceConfig, region: Region, store: EventStore, fetchFn: typeof fetch) {
  try {
    const events = await adapters[source.adapter](source, region, fetchFn, new Date());
    await store.replaceSource(source.id, events);
    console.log(`${region.id}/${source.id}: ${events.length} Events`);
  } catch (error) {
    console.error(`${region.id}/${source.id}: refresh failed:`, error);
  }
}
