import type { Event, Geometry, LocalizedText, MainlyAffected, Severity } from "@pulse/schema";
import { XMLParser } from "fast-xml-parser";
import type { CapSource, Region } from "../regions/index.ts";
import { statusAt } from "./land-use-permits.ts";

// CAP 1.2 (OASIS Common Alerting Protocol) read from an Atom feed of alerts. Nothing here is specific to one
// publisher: what differs per Source (eventCode → Mainly affected, attribution) comes from its config.

type Ring = [number, number][];

export interface CapInfo {
  language: string;
  event?: string;
  severity: string;
  eventCodes: string[];
  onset?: string;
  effective?: string;
  expires?: string;
  headline?: string;
  description?: string;
  polygons: Ring[];
}

export interface CapAlert {
  identifier: string;
  sender: string;
  sent: string;
  status: string;
  msgType: string;
  references: { sender: string; identifier: string; sent: string }[];
  infos: CapInfo[];
}

export interface CapContext {
  source: CapSource;
  region: Region;
  now: Date;
  previous?: Event[];
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => ["entry", "link", "info", "area", "polygon", "eventCode"].includes(name),
});

export async function fetchAlerts(source: CapSource, fetchFn: typeof fetch = fetch): Promise<CapAlert[]> {
  const res = await fetchFn(source.url);
  if (!res.ok) throw new Error(`${source.id}: CAP feed responded ${res.status}`);
  const { alerts, links } = readFeed(await res.text());
  // Feeds that only link each alert instead of embedding it.
  const linked = await Promise.all(
    links.map(async (href) => {
      const alertRes = await fetchFn(href);
      if (!alertRes.ok) throw new Error(`${source.id}: CAP alert ${href} responded ${alertRes.status}`);
      return readAlert(await alertRes.text());
    }),
  );
  return [...alerts, ...linked.flat()];
}

// The alerts embedded in an Atom feed's entries, and the CAP links of entries that don't embed one.
export function readFeed(xml: string): { alerts: CapAlert[]; links: string[] } {
  const entries = ((parser.parse(xml) as Node).feed as Node | undefined)?.entry as Node[] | undefined;
  const alerts: CapAlert[] = [];
  const links: string[] = [];
  for (const entry of entries ?? []) {
    const embedded = (entry.content as Node | undefined)?.alert as Node | undefined;
    if (embedded) {
      alerts.push(toAlert(embedded));
      continue;
    }
    const link = (entry.link as Node[] | undefined)?.find((l) => l["@_type"] === "application/cap+xml");
    if (typeof link?.["@_href"] === "string") links.push(link["@_href"]);
  }
  return { alerts, links };
}

export function readAlert(xml: string): CapAlert[] {
  const alert = (parser.parse(xml) as Node).alert as Node | undefined;
  return alert ? [toAlert(alert)] : [];
}

function toAlert(node: Node): CapAlert {
  return {
    identifier: text(node.identifier) ?? "",
    sender: text(node.sender) ?? "",
    sent: text(node.sent) ?? "",
    status: text(node.status) ?? "",
    msgType: text(node.msgType) ?? "",
    references: (text(node.references) ?? "").split(/\s+/).flatMap((triple) => {
      const [sender, identifier, sent] = triple.split(",");
      return sender && identifier && sent ? [{ sender, identifier, sent }] : [];
    }),
    infos: ((node.info as Node[] | undefined) ?? []).map((info) => ({
      language: text(info.language) ?? "en-US", // CAP's default
      event: text(info.event),
      severity: text(info.severity) ?? "Unknown",
      eventCodes: ((info.eventCode as Node[] | undefined) ?? []).flatMap((code) => text(code.value) ?? []),
      onset: text(info.onset),
      effective: text(info.effective),
      expires: text(info.expires),
      headline: text(info.headline),
      description: text(info.description),
      polygons: ((info.area as Node[] | undefined) ?? []).flatMap((area) =>
        ((area.polygon as unknown[] | undefined) ?? []).flatMap((p) => text(p) ?? []).map(toRing),
      ),
    })),
  };
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

// CAP polygons are space-separated "lat,lon" pairs; GeoJSON wants [lon, lat] and closed rings.
function toRing(polygon: string): Ring {
  const ring = polygon.split(/\s+/).map((pair): [number, number] => {
    const [lat, lon] = pair.split(",").map(Number);
    return [lon!, lat!];
  });
  const [first, last] = [ring[0], ring.at(-1)];
  return first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...ring, first] : ring;
}

const SEVERITY: Record<string, Severity> = { Extreme: "major", Severe: "major", Moderate: "consider", Minor: "minor" };

export function toEvents(alerts: CapAlert[], { source, region, now, previous = [] }: CapContext): Event[] {
  // An Update or Cancel is a new alert that references the ones it supersedes. The Event keeps the id it already
  // has, found through the alert identifier each Event carries as its Source id.
  const eventIdOf = new Map(previous.map((event) => [event.sources[0]?.id, event.id]));
  const before = new Map(previous.map((event) => [event.id, event]));
  const events = new Map<string, Event>();

  for (const alert of [...alerts].sort((a, b) => Date.parse(a.sent) - Date.parse(b.sent))) {
    if (alert.status !== "Actual" || !["Alert", "Update", "Cancel"].includes(alert.msgType)) continue;
    const id = eventId(alert, eventIdOf, source);
    eventIdOf.set(alert.identifier, id);
    const existing = events.get(id) ?? before.get(id);
    const event = alert.msgType === "Cancel" && existing ? cancel(existing, alert) : toEvent(alert, id, { source, region, now });
    if (event) events.set(id, event);
    else events.delete(id);
  }
  return [...events.values()];
}

// A Cancel resolves the Event it references as it was, ending it when the Cancel was sent.
function cancel(event: Event, alert: CapAlert): Event {
  const sent = new Date(alert.sent).toISOString();
  const end = event.when.end && event.when.end < sent ? event.when.end : sent;
  const [first, ...rest] = event.sources;
  return {
    ...event,
    when: { ...event.when, end },
    status: "resolved",
    sources: first ? [{ ...first, id: alert.identifier, updatedAt: sent }, ...rest] : event.sources,
    updatedAt: sent,
  };
}

function eventId(alert: CapAlert, eventIdOf: Map<string | undefined, string>, source: CapSource): string {
  for (const ref of alert.references) {
    const known = eventIdOf.get(ref.identifier);
    if (known) return known;
  }
  const first = [...alert.references].sort((a, b) => Date.parse(a.sent) - Date.parse(b.sent))[0];
  return `${source.id}:${first?.identifier ?? alert.identifier}`;
}

function toEvent(alert: CapAlert, id: string, { source, region, now }: Omit<CapContext, "previous">): Event | undefined {
  const info = alert.infos[0];
  if (!info) return undefined;
  const geometry = geometryIn(info.polygons, region.bbox);
  if (!geometry) return undefined;

  const sent = new Date(alert.sent).toISOString();
  const start = new Date(info.onset ?? info.effective ?? alert.sent).toISOString();
  const expires = info.expires ? new Date(info.expires).toISOString() : undefined;
  const cancelled = alert.msgType === "Cancel";
  const end = cancelled && (!expires || sent < expires) ? sent : expires;
  const code = info.eventCodes.find((c) => source.mainlyAffected?.[c]);
  const mainlyAffected: MainlyAffected = (code && source.mainlyAffected?.[code]) || "everyone";

  return {
    id,
    kind: "weather",
    layers: ["area", "trips"],
    title: byLanguage(alert.infos, (i) => i.headline ?? i.event),
    ...(alert.infos.some((i) => i.description) ? { originalText: byLanguage(alert.infos, (i) => i.description) } : {}),
    where: { geometry, precision: "area" },
    when: { start, ...(end ? { end } : {}) },
    severity: SEVERITY[info.severity] ?? "info",
    mainlyAffected,
    noticeable: [],
    status: cancelled ? "resolved" : statusAt(now, start, end),
    sources: [
      {
        name: source.publisher,
        id: alert.identifier,
        updatedAt: sent,
        license: source.license,
        ...(source.attribution ? { attribution: source.attribution } : {}),
      },
    ],
    confidence: 1,
    updatedAt: sent,
  };
}

// One text per language ("fi-FI" → "fi"), the first info of each language.
function byLanguage(infos: CapInfo[], pick: (info: CapInfo) => string | undefined): LocalizedText {
  const texts: LocalizedText = {};
  for (const info of infos) {
    const lang = info.language.split("-")[0]!.toLowerCase();
    const value = pick(info);
    if (value && !(lang in texts)) texts[lang] = value;
  }
  return texts;
}

// The warning areas that reach into the Region; none means the alert isn't for this Region.
function geometryIn(polygons: Ring[], [minLon, minLat, maxLon, maxLat]: Region["bbox"]): Geometry | undefined {
  const inside = polygons.filter((ring) => {
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);
    return Math.min(...lons) <= maxLon && Math.max(...lons) >= minLon && Math.min(...lats) <= maxLat && Math.max(...lats) >= minLat;
  });
  if (inside.length === 0) return undefined;
  if (inside.length === 1) return { type: "Polygon", coordinates: [inside[0]!] };
  return { type: "MultiPolygon", coordinates: inside.map((ring) => [ring]) };
}
