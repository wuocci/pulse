import type { Event, EventKind, EventStatus, Geometry } from "@pulse/schema";

export interface EventQuery {
  near?: { lat: number; lon: number; radiusM: number };
  from?: Date;
  to?: Date;
  kind?: EventKind;
  statuses?: EventStatus[];
}

export interface EventStore {
  // Replaces every Event from one Source (by its config id) with a fresh set.
  replaceSource(sourceId: string, events: Event[]): Promise<void>;
  query(query: EventQuery): Promise<Event[]>;
}

// Until Postgres + PostGIS lands (#2), Events live in memory and distance is measured to the geometry's bounding box.
export class InMemoryEventStore implements EventStore {
  private bySource = new Map<string, Event[]>();

  async replaceSource(sourceId: string, events: Event[]) {
    this.bySource.set(sourceId, events);
  }

  async query({ near, from, to, kind, statuses }: EventQuery) {
    return [...this.bySource.values()].flat().filter((event) => {
      if (kind && event.kind !== kind) return false;
      if (statuses && !statuses.includes(event.status)) return false;
      if (to && new Date(event.when.start) > to) return false;
      if (from && event.when.end && new Date(event.when.end) < from) return false;
      if (near && distanceToBoundsM(near, event.where.geometry) > near.radiusM) return false;
      return true;
    });
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
