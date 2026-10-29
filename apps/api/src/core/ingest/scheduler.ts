import { fetchPermits, type PermitItem, toPermitItems } from "../adapters/land-use-permits.ts";
import type { Classification } from "../classifier/enrich.ts";
import type { EventStore } from "../events/store.ts";
import type { Region, SourceConfig } from "../regions/index.ts";

type Adapter = (source: SourceConfig, region: Region, fetchFn: typeof fetch, now: Date) => Promise<PermitItem[]>;

const adapters: Record<SourceConfig["adapter"], Adapter> = {
  "land-use-permits": async (source, region, fetchFn, now) =>
    toPermitItems(await fetchPermits(source, fetchFn), { source, timeZone: region.timeZone, now }),
};

export interface IngestOptions {
  fetchFn?: typeof fetch;
  // Without it, Events are published as their Adapter made them.
  classification?: Classification;
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

export async function refreshSource(
  source: SourceConfig,
  region: Region,
  store: EventStore,
  { fetchFn = fetch, classification }: IngestOptions = {},
) {
  try {
    const now = new Date();
    const items = await adapters[source.adapter](source, region, fetchFn, now);
    const { events, classifyRest } = classification
      ? await classification.prepare(source, items, { timeZone: region.timeZone, now })
      : { events: items.map((item) => item.event), classifyRest: undefined };
    await store.replaceSource(source.id, events);
    console.log(`${region.id}/${source.id}: ${events.length} Events`);
    // In the background: the next refresh doesn't wait for it.
    void classifyRest?.();
  } catch (error) {
    console.error(`${region.id}/${source.id}: refresh failed:`, error);
  }
}
