import type { Event, EventKind, EventStatus, Geometry, Layer, Noticeable } from "@pulse/schema";

export interface EventQuery {
  near?: { lat: number; lon: number; radiusM: number };
  from?: Date;
  to?: Date;
  kind?: EventKind;
  statuses?: EventStatus[];
  // Any match
  noticeable?: Noticeable[];
  // Any match
  layers?: Layer[];
  // Nearest first; needs `near`. Otherwise the order is unspecified.
  orderBy?: "distance";
}

export interface EventStore {
  // Replaces every Event from one Source (by its config id) with a fresh set.
  replaceSource(sourceId: string, events: Event[]): Promise<void>;
  // Replaces one stored Event with a newer version of itself, e.g. once the Classifier has answered.
  // Does nothing if a refresh replaced `previous` since (its updatedAt no longer matches); returns whether it replaced.
  replaceEvent(sourceId: string, previous: Event, next: Event): Promise<boolean>;
  // Every Event stored for one Source.
  sourceEvents(sourceId: string): Promise<Event[]>;
  query(query: EventQuery): Promise<Event[]>;
}

// Until Postgres + PostGIS lands (#2), Events live in memory and distance is measured to the geometry's bounding box.
export class InMemoryEventStore implements EventStore {
  private bySource = new Map<string, Event[]>();

  async replaceSource(sourceId: string, events: Event[]) {
    this.bySource.set(sourceId, events);
  }

  async replaceEvent(sourceId: string, previous: Event, next: Event) {
    const events = this.bySource.get(sourceId) ?? [];
    const i = events.findIndex((e) => e.id === previous.id && e.updatedAt === previous.updatedAt);
    if (i === -1) return false;
    this.bySource.set(sourceId, events.with(i, next));
    return true;
  }

  async sourceEvents(sourceId: string) {
    return this.bySource.get(sourceId) ?? [];
  }

  async query({ near, from, to, kind, statuses, noticeable, layers, orderBy }: EventQuery) {
    const matches = [...this.bySource.values()]
      .flat()
      .filter((event) => {
        if (kind && event.kind !== kind) return false;
        if (statuses && !statuses.includes(event.status)) return false;
        if (noticeable && !event.noticeable.some((n) => noticeable.includes(n))) return false;
        if (layers && !event.layers.some((l) => layers.includes(l))) return false;
        if (to && new Date(event.when.start) > to) return false;
        if (from && event.when.end && new Date(event.when.end) < from) return false;
        return true;
      })
      .map((event) => ({ event, distanceM: near ? distanceToBoundsM(near, event.where.geometry) : 0 }))
      .filter(({ distanceM }) => !near || distanceM <= near.radiusM);
    if (orderBy === "distance") matches.sort((a, b) => a.distanceM - b.distanceM);
    return matches.map(({ event }) => event);
  }
}

const EARTH_RADIUS_M = 6_371_000;

function distanceToBoundsM(point: { lat: number; lon: number }, geometry: Geometry): number {
  const [minLon, minLat, maxLon, maxLat] = bounds(geometry);
  const lat = Math.min(Math.max(point.lat, minLat), maxLat);
  const lon = Math.min(Math.max(point.lon, minLon), maxLon);
  // Equirectangular approximation: accurate enough at city scale.
  const x = toRad(lon - point.lon) * Math.cos(toRad((lat + point.lat) / 2));
  const y = toRad(lat - point.lat);
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
}

function bounds(geometry: Geometry): [number, number, number, number] {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === "number") {
      const [lon, lat] = coords as [number, number];
      box[0] = Math.min(box[0], lon);
      box[1] = Math.min(box[1], lat);
      box[2] = Math.max(box[2], lon);
      box[3] = Math.max(box[3], lat);
      return;
    }
    for (const child of coords as unknown[]) visit(child);
  };
  visit(geometry.coordinates);
  return box;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
