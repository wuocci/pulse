import type { Event, Geometry } from "@pulse/schema";
import type { SourceConfig } from "../regions/index.ts";

// Custom Adapter (ADR 0002) for a city permit system's WFS, which publishes no standard format.
// The same system publishes excavation notices, temporary traffic arrangements and outdoor events,
// one layer each. Only excavation notices are mapped so far.
// The WFS reprojects to WGS84 itself (srsName), so no projection library is needed.

export interface PermitNotice {
  hakemustunnus: string;
  tyo_alkaa: string | null;
  tyo_paattyy: string | null;
  tyon_tarkoitus: string | null;
  osoite: string | null;
}

export interface PermitCollection {
  features: { geometry: Geometry | null; properties: PermitNotice }[];
}

export interface PermitContext {
  source: SourceConfig;
  timeZone: string;
  now: Date;
}

export function permitsUrl(source: SourceConfig): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: source.layer,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  return `${source.url}?${params}`;
}

export async function fetchPermits(source: SourceConfig, fetchFn: typeof fetch = fetch): Promise<PermitCollection> {
  const res = await fetchFn(permitsUrl(source));
  if (!res.ok) throw new Error(`${source.id}: WFS responded ${res.status}`);
  return (await res.json()) as PermitCollection;
}

export function toEvents(collection: PermitCollection, { source, timeZone, now }: PermitContext): Event[] {
  const events: Event[] = [];
  for (const { geometry, notice } of groupByNotice(collection)) {
    if (!notice.tyo_alkaa) continue;
    const start = localTime(notice.tyo_alkaa, "00:00:00", timeZone);
    const end = notice.tyo_paattyy ? localTime(notice.tyo_paattyy, "23:59:59", timeZone) : undefined;
    const address = (notice.osoite ?? "").split(",")[0]!.trim();
    const text = notice.tyon_tarkoitus?.trim();

    events.push({
      id: `${source.id}:${notice.hakemustunnus}`,
      kind: source.kind,
      layers: ["area"],
      title: titles(address, notice.tyo_paattyy),
      ...(text ? { originalText: { fi: text } } : {}),
      where: { geometry, precision: "area" },
      when: { start, ...(end ? { end } : {}) },
      // No structure to base Severity on; overlapping temporary traffic arrangements will set it.
      severity: "minor",
      status: statusAt(now, start, end),
      sources: [
        {
          name: source.publisher,
          id: notice.hakemustunnus,
          updatedAt: now.toISOString(),
          license: source.license,
        },
      ],
      confidence: 0,
      updatedAt: now.toISOString(),
    });
  }
  return events;
}

// The WFS returns one feature per area, and one notice can cover many areas (up to 128 seen).
// One notice is one Event, so its areas are merged into a single MultiPolygon.
function groupByNotice(collection: PermitCollection) {
  const groups = new Map<string, { notice: PermitNotice; polygons: number[][][][] }>();
  for (const { geometry, properties } of collection.features) {
    if (!geometry) continue;
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    const group = groups.get(properties.hakemustunnus);
    if (group) group.polygons.push(...polygons);
    else groups.set(properties.hakemustunnus, { notice: properties, polygons: [...polygons] });
  }
  return [...groups.values()]
    .filter((g) => g.polygons.length > 0)
    .map((g) => ({ notice: g.notice, geometry: { type: "MultiPolygon", coordinates: g.polygons } as Geometry }));
}

// Moves to a shared title module that writes every Region language (Q15 in the plan).
function titles(address: string, endDate: string | null): Record<string, string> {
  const en = ["Excavation"];
  const fi = ["Kaivutyö"];
  if (address) {
    en.push(address);
    fi.push(address);
  }
  if (endDate) {
    const [year, month, day] = endDate.slice(0, 10).split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    en.push(`until ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`);
    fi.push(`${day}.${month}. asti`);
  }
  return { en: en.join(" · "), fi: fi.join(" · ") };
}

function statusAt(now: Date, start: string, end: string | undefined): Event["status"] {
  if (now < new Date(start)) return "upcoming";
  if (end && now > new Date(end)) return "resolved";
  return "active";
}

// A local date and time in the given IANA time zone, as an ISO string with that day's UTC offset.
export function localTime(date: string, time: string, timeZone: string): string {
  const day = date.slice(0, 10);
  const guess = new Date(`${day}T${time}Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")!
    .value.replace("GMT", "");
  return `${day}T${time}${offset || "+00:00"}`;
}
