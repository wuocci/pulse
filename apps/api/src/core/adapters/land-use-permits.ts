import type { Event, Geometry, Noticeable, Severity } from "@pulse/schema";
import type { ClassifierState } from "../classifier/classifier.ts";
import type { LandUsePermitSource } from "../regions/index.ts";

// Custom Adapter (ADR 0002) for a city permit system's WFS, which publishes no standard format.
// The system publishes excavation notices, temporary traffic arrangements and outdoor events, one layer each,
// with shared fields (id, address, district) and per-layer dates and texts.
// The WFS reprojects to WGS84 itself (srsName), so no projection library is needed.

// Fields vary by layer, so they're read by name through `field()`.
type Field = string | null;
export type PermitNotice = { hakemustunnus: string } & Record<string, unknown>;

// A text field's value, or null when it's missing, empty or not text.
function field(notice: PermitNotice, name: string): Field {
  const value = notice[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export interface PermitCollection {
  features: { geometry: Geometry | null; properties: PermitNotice }[];
}

export interface PermitContext {
  source: LandUsePermitSource;
  timeZone: string;
  now: Date;
}

interface PermitType {
  kind: Event["kind"];
  severity: Severity;
  // What a person nearby would sense, by rule on the layer; no Classifier needed.
  noticeable: Noticeable[];
  // The dates the notice occupies the street, as YYYY-MM-DD
  occupies(p: PermitNotice): { start: Field; end: Field };
  label(p: PermitNotice): { en: string; fi: string };
  // Extra title part, e.g. an event's own dates when they differ from the occupied period
  detail?(p: PermitNotice): { en: string; fi: string } | undefined;
  text?(p: PermitNotice): Field;
  // What else the Classifier reads about a notice, beyond the Event. Internal: never on the Event or in the API.
  facts(p: PermitNotice): Record<string, Field | number | undefined>;
}

// An Event with the facts its notice gives the Classifier.
export interface PermitItem {
  event: Event;
  facts: ClassifierState;
}

const PERMIT_TYPES: Record<LandUsePermitSource["permitType"], PermitType> = {
  excavation: {
    kind: "works",
    // No structure to base Severity on; overlapping traffic arrangements will set it (with PostGIS, #2).
    severity: "minor",
    noticeable: ["noise", "blocked"],
    occupies: (p) => ({ start: field(p, "tyo_alkaa"), end: field(p, "tyo_paattyy") }),
    label: () => ({ en: "Excavation", fi: "Kaivutyö" }),
    text: (p) => field(p, "tyon_tarkoitus"),
    facts: (p) => ({ address: field(p, "osoite") }),
  },
  "traffic-arrangement": {
    kind: "closure",
    // A permit to change traffic: lanes, parking or a street taken out of use.
    severity: "consider",
    noticeable: ["blocked"],
    occupies: (p) => ({ start: field(p, "liikennejarjestely_alkaa"), end: field(p, "liikennejarjestely_paattyy") }),
    label: () => ({ en: "Traffic arrangement", fi: "Liikennejärjestely" }),
    text: (p) => field(p, "tyon_tarkoitus"),
    facts: (p) => ({ category: field(p, "hakemuksen_laji"), address: field(p, "osoite") }),
  },
  "outdoor-event": {
    kind: "public_event",
    severity: "minor",
    noticeable: ["crowd", "noise"],
    // Build-up and teardown occupy the area too, so the Event spans them.
    occupies: (p) => ({
      start: field(p, "rakentaminen_alkaa") ?? field(p, "tapahtuma_alkaa"),
      end: field(p, "purkaminen_paattyy") ?? field(p, "tapahtuma_paattyy"),
    }),
    // Promotions are all named just "Promootio"; real events keep their own name in every language.
    label: (p) => {
      const name = field(p, "nimi");
      return field(p, "hakemuksen_laji") === "Promootio" || !name ? { en: "Promotion", fi: "Promootio" } : { en: name, fi: name };
    },
    detail: (p) =>
      field(p, "rakentaminen_alkaa") || field(p, "purkaminen_paattyy")
        ? dateRange(field(p, "tapahtuma_alkaa"), field(p, "tapahtuma_paattyy"))
        : undefined,
    facts: (p) => {
      const [buildUp, start, end, teardown] = ["rakentaminen_alkaa", "tapahtuma_alkaa", "tapahtuma_paattyy", "purkaminen_paattyy"].map(
        (name) => field(p, name),
      );
      return {
        category: field(p, "hakemuksen_laji"),
        address: field(p, "osoite"),
        // Whether entry is open to all ("Avoin") or not.
        entry: field(p, "tapahtuman_luonne"),
        buildUpDays: buildUp && start ? daysBetween(buildUp, start) : undefined,
        eventDays: start && end ? daysBetween(start, end) + 1 : undefined,
        teardownDays: end && teardown ? daysBetween(end, teardown) : undefined,
      };
    },
  },
};

export function permitsUrl(source: LandUsePermitSource): string {
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

export async function fetchPermits(source: LandUsePermitSource, fetchFn: typeof fetch = fetch): Promise<PermitCollection> {
  const res = await fetchFn(permitsUrl(source));
  if (!res.ok) throw new Error(`${source.id}: WFS responded ${res.status}`);
  return (await res.json()) as PermitCollection;
}

export function toEvents(collection: PermitCollection, context: PermitContext): Event[] {
  return toPermitItems(collection, context).map((item) => item.event);
}

export function toPermitItems(collection: PermitCollection, { source, timeZone, now }: PermitContext): PermitItem[] {
  const type = PERMIT_TYPES[source.permitType];
  const items: PermitItem[] = [];
  for (const { geometry, notice } of groupByNotice(collection)) {
    const occupied = type.occupies(notice);
    if (!occupied.start) continue;
    const start = localTime(occupied.start, "00:00:00", timeZone);
    const end = occupied.end ? localTime(occupied.end, "23:59:59", timeZone) : undefined;
    const text = type.text?.(notice)?.trim();

    const event: Event = {
      id: `${source.id}:${notice.hakemustunnus}`,
      kind: type.kind,
      layers: ["area"],
      title: titles(type.label(notice), place(notice), type.detail?.(notice) ?? until(occupied.end)),
      ...(text ? { originalText: { fi: text } } : {}),
      where: { geometry, precision: "area" },
      when: { start, ...(end ? { end } : {}) },
      severity: type.severity,
      mainlyAffected: "unknown",
      noticeable: [...type.noticeable],
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
    };
    const facts = Object.fromEntries(
      Object.entries(type.facts(notice)).filter((entry): entry is [string, string | number] => entry[1] != null),
    );
    items.push({ event, facts });
  }
  return items;
}

// Whole days from one YYYY-MM-DD date to another.
function daysBetween(from: string, to: string): number {
  const day = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Math.round((day(to) - day(from)) / 86_400_000);
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

// The first address, or else the district: "2 KLUUVI" → "Kluuvi".
function place(notice: PermitNotice): string {
  const address = (field(notice, "osoite") ?? "").split(",")[0]!.trim();
  if (address) return address;
  const district = (field(notice, "kaupunginosa") ?? "").replace(/^\d+\s*/, "").trim().toLowerCase();
  return district.replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
}

// Moves to a shared title module that writes every Region language (Q15 in the plan).
function titles(
  label: { en: string; fi: string },
  place: string,
  detail: { en: string; fi: string } | undefined,
): Record<string, string> {
  const join = (lang: "en" | "fi") => [label[lang], place, detail?.[lang]].filter(Boolean).join(" · ");
  return { en: join("en"), fi: join("fi") };
}

function until(endDate: Field): { en: string; fi: string } | undefined {
  if (!endDate) return undefined;
  const { day, month, short } = dateParts(endDate);
  return { en: `until ${day} ${short}`, fi: `${day}.${month}. asti` };
}

function dateRange(startDate: Field, endDate: Field): { en: string; fi: string } | undefined {
  if (!startDate) return undefined;
  const s = dateParts(startDate);
  if (!endDate || endDate === startDate) return { en: `${s.day} ${s.short}`, fi: `${s.day}.${s.month}.` };
  const e = dateParts(endDate);
  return { en: `${s.day} ${s.short} – ${e.day} ${e.short}`, fi: `${s.day}.${s.month}.–${e.day}.${e.month}.` };
}

function dateParts(date: string) {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const short = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return { day, month, short };
}

export function statusAt(now: Date, start: string, end: string | undefined): Event["status"] {
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
