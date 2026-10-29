import type { Event, Geometry, Severity } from "@pulse/schema";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { GtfsRtSource, Region } from "../regions/index.ts";
import { statusAt } from "./land-use-permits.ts";

// GTFS-RT Adapter (ADR 0002): service alerts from any GTFS-RT feed, configured per Source.
// Alerts name stops and routes by id only, so a stop directory gives their locations and names.
// The structure is in the feed (effect, severity, lines, stops), so no Classifier (ADR 0003).

const { transit_realtime } = GtfsRealtimeBindings;
const { Effect, SeverityLevel } = transit_realtime.Alert;

// One alert, decoded. Ids are the feed's own, before the Source's feed id prefixes them.
export interface ServiceAlert {
  id: string;
  // POSIX seconds; a missing start or end is open
  periods: { start?: number; end?: number }[];
  stopIds: string[];
  routeIds: string[];
  effect: number;
  severity: number;
  header: Record<string, string>;
  description: Record<string, string>;
  url: Record<string, string>;
}

export interface StopInfo {
  name: string;
  lat: number;
  lon: number;
}

export interface RouteInfo {
  shortName: string;
  mode: string;
}

// What the directory knows, by prefixed id ("HSL:1234"). Unknown ids are left out.
export interface Directory {
  stops: Map<string, StopInfo>;
  routes: Map<string, RouteInfo>;
}

export interface StopDirectory {
  lookup(ids: { stops: string[]; routes: string[] }): Promise<Directory>;
}

export interface AlertContext {
  source: GtfsRtSource;
  region: Region;
  now: Date;
}

const SEVERITY: Record<number, Severity> = {
  [SeverityLevel.INFO]: "info",
  [SeverityLevel.WARNING]: "consider",
  [SeverityLevel.SEVERE]: "major",
};

// Effects a person at the stop runs into (PRD #20): these alerts enter Right now when they list stops.
const AT_THE_STOP = new Set<number>([Effect.NO_SERVICE, Effect.STOP_MOVED, Effect.DETOUR]);

export async function fetchAlerts(source: GtfsRtSource, fetchFn: typeof fetch = fetch): Promise<ServiceAlert[]> {
  const res = await fetchFn(source.url);
  if (!res.ok) throw new Error(`${source.id}: GTFS-RT feed responded ${res.status}`);
  return decodeAlerts(new Uint8Array(await res.arrayBuffer()));
}

export function decodeAlerts(bytes: Uint8Array): ServiceAlert[] {
  const feed = transit_realtime.FeedMessage.decode(bytes);
  return feed.entity.flatMap(({ id, alert }) => {
    if (!alert) return [];
    const informed = alert.informedEntity ?? [];
    return [
      {
        id,
        periods: (alert.activePeriod ?? []).map(({ start, end }) => ({
          ...(start ? { start: Number(start) } : {}),
          ...(end ? { end: Number(end) } : {}),
        })),
        stopIds: unique(informed.flatMap((e) => (e.stopId ? [e.stopId] : []))),
        routeIds: unique(informed.flatMap((e) => (e.routeId ? [e.routeId] : []))),
        effect: alert.effect ?? Effect.UNKNOWN_EFFECT,
        severity: alert.severityLevel ?? SeverityLevel.UNKNOWN_SEVERITY,
        header: translations(alert.headerText),
        description: translations(alert.descriptionText),
        url: translations(alert.url),
      },
    ];
  });
}

// The prefixed ids to look up for a set of alerts.
export function idsToLook(alerts: ServiceAlert[], source: GtfsRtSource): { stops: string[]; routes: string[] } {
  return {
    stops: unique(alerts.flatMap((a) => a.stopIds.map((id) => prefixed(source, id)))),
    routes: unique(alerts.flatMap((a) => a.routeIds.map((id) => prefixed(source, id)))),
  };
}

export function toEvents(alerts: ServiceAlert[], directory: Directory, { source, region, now }: AlertContext): Event[] {
  return alerts.map((alert) => {
    const stops = alert.stopIds.map((id) => prefixed(source, id));
    const located = stops.flatMap((id) => {
      const stop = directory.stops.get(id);
      return stop ? [[stop.lon, stop.lat]] : [];
    });
    const atTheStop = located.length > 0 && AT_THE_STOP.has(alert.effect);
    const { start, end } = window(alert, now);
    const url = firstIn(alert.url, region.languages);

    return {
      id: `${source.id}:${alert.id}`,
      kind: "disruption",
      layers: atTheStop ? ["trips", "now"] : ["trips"],
      title: alert.header,
      ...(Object.keys(alert.description).length ? { originalText: alert.description } : {}),
      where: {
        geometry: located.length ? points(located) : bboxPolygon(region.bbox),
        precision: located.length ? "exact" : "vague",
        ...(alert.routeIds.length ? { lines: alert.routeIds.map((id) => prefixed(source, id)) } : {}),
        ...(stops.length ? { stops } : {}),
      },
      when: { start, ...(end ? { end } : {}) },
      severity: SEVERITY[alert.severity] ?? "minor",
      mainlyAffected: "transit",
      noticeable: atTheStop ? ["outage"] : [],
      status: statusAt(now, start, end),
      sources: [
        {
          name: source.publisher,
          id: alert.id,
          ...(url ? { url } : {}),
          updatedAt: now.toISOString(),
          license: source.license,
        },
      ],
      // The feed's own structure, not a Classifier's guess.
      confidence: 1,
      updatedAt: now.toISOString(),
    };
  });
}

const prefixed = (source: GtfsRtSource, id: string) => `${source.feedId}:${id}`;

// From the earliest start to the latest end. A period without a start began before the feed says; one without
// an end leaves the Event open.
function window({ periods }: ServiceAlert, now: Date): { start: string; end?: string } {
  const starts = periods.map((p) => p.start);
  const ends = periods.map((p) => p.end);
  const start = starts.length && starts.every((s) => s !== undefined) ? Math.min(...(starts as number[])) : undefined;
  const end = ends.length && ends.every((e) => e !== undefined) ? Math.max(...(ends as number[])) : undefined;
  return {
    start: start !== undefined ? new Date(start * 1000).toISOString() : now.toISOString(),
    ...(end !== undefined ? { end: new Date(end * 1000).toISOString() } : {}),
  };
}

function points(coordinates: number[][]): Geometry {
  return coordinates.length === 1 ? { type: "Point", coordinates: coordinates[0]! } : { type: "MultiPoint", coordinates };
}

function bboxPolygon([minLon, minLat, maxLon, maxLat]: Region["bbox"]): Geometry {
  return {
    type: "Polygon",
    coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
  };
}

function translations(text: { translation?: { text?: string | null; language?: string | null }[] | null } | null | undefined) {
  return Object.fromEntries(
    (text?.translation ?? []).flatMap(({ text, language }) => (text?.trim() ? [[language || "und", text.trim()]] : [])),
  );
}

function firstIn(text: Record<string, string>, languages: string[]): string | undefined {
  return languages.map((l) => text[l]).find(Boolean) ?? Object.values(text)[0];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
