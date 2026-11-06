import type { Event, LocalizedText } from "@pulse/schema";
import type { LinkedEventsSource, Region } from "../regions/index.ts";
import { statusAt } from "./land-use-permits.ts";

// Linked Events Adapter (ADR 0002): an open event calendar (JSON API). Only big events come through: those at a
// venue that holds a crowd, as Public events with crowd. Pulse isn't a culture calendar. Times and place are in the
// calendar's structure; how many actually come isn't, so the Classifier judges that (ADR 0003, calendarSubject).

// As far ahead as My area looks.
const WINDOW_DAYS = 14;
const PAGE_SIZE = 100;
// A runaway `next` link stops here; two pages is usual.
const MAX_PAGES = 10;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface LinkedEvent {
  id: string;
  name: LocalizedText | null;
  short_description: LocalizedText | null;
  info_url: LocalizedText | null;
  location: {
    id: string;
    name: LocalizedText | null;
    position: { type: "Point"; coordinates: number[] } | null;
  } | null;
  start_time: string | null;
  end_time: string | null;
  event_status: "EventScheduled" | "EventRescheduled" | "EventPostponed" | "EventCancelled";
  super_event_type: "recurring" | "umbrella" | null;
  sub_events: { "@id": string }[];
  maximum_attendee_capacity: number | null;
  last_modified_time: string;
}

interface Page {
  meta: { next: string | null };
  data: LinkedEvent[];
}

export interface CalendarContext {
  source: LinkedEventsSource;
  region: Region;
  now: Date;
}

// Events in the Region's bbox from now to two weeks ahead, at venues of at least the Region's crowd size.
export async function fetchEvents({ source, region, now }: CalendarContext, fetchFn: typeof fetch = fetch): Promise<LinkedEvent[]> {
  const url = new URL(source.url);
  url.searchParams.set("start", now.toISOString());
  url.searchParams.set("end", new Date(now.getTime() + WINDOW_DAYS * DAY_MS).toISOString());
  url.searchParams.set("bbox", region.bbox.join(","));
  url.searchParams.set("maximum_attendee_capacity_gte", String(region.crowd.area));
  url.searchParams.set("include", "location");
  url.searchParams.set("page_size", String(PAGE_SIZE));

  const events: LinkedEvent[] = [];
  let next: string | null = url.toString();
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const res = await fetchFn(next);
    if (!res.ok) throw new Error(`${source.id}: Linked Events responded ${res.status}`);
    const body = (await res.json()) as Page;
    events.push(...body.data);
    next = body.meta.next;
  }
  return events;
}

export function toEvents(events: LinkedEvent[], { source, region, now }: CalendarContext): Event[] {
  return events.flatMap((event) => {
    const { start_time: start, location } = event;
    // Postponed: no new date yet. Online events sit at a stand-in point in the city centre.
    if (event.event_status === "EventPostponed" || !start || !location?.position || location.id.endsWith(":internet")) return [];
    const capacity = event.maximum_attendee_capacity ?? 0;
    if (capacity < region.crowd.area) return [];
    // Split into an entry per day or per show: those entries are published, not the event that holds them.
    if (event.super_event_type && event.sub_events.length) return [];
    // Over a day with no entry per day: an exhibition or a season, not a crowd at any one time. Judged by the
    // calendar's own end, even a 23:59 one: that's still the day it ends.
    if (event.end_time && new Date(event.end_time).getTime() - new Date(start).getTime() > DAY_MS) return [];
    const end = endOf(event, start, region);

    const name = textOf(event.name);
    const venue = textOf(location.name);
    const description = textOf(event.short_description);
    const url = firstIn(event.info_url, region.languages);

    return [
      {
        id: `${source.id}:${event.id}`,
        kind: "public_event",
        layers: ["area", "now"],
        title: titleOf(name, venue),
        ...(Object.keys(description).length ? { originalText: description } : {}),
        where: { geometry: { type: "Point", coordinates: location.position.coordinates }, precision: "exact" },
        // Its own hours, so Right now doesn't take the usual ones for public events instead.
        when: { start, end, dailyHours: { from: clockAt(start, region.timeZone), to: clockAt(end, region.timeZone) } },
        // Until the Classifier says how many come: a venue that big is worth considering whatever is on.
        severity: capacity >= region.crowd.trips ? "consider" : "minor",
        mainlyAffected: "everyone",
        noticeable: ["crowd"],
        crowdSize: capacity,
        // Cancelled: resolved, so that "tonight's match is off" reaches people.
        status: event.event_status === "EventCancelled" ? "resolved" : statusAt(now, start, end),
        sources: [
          {
            name: source.publisher,
            id: event.id,
            ...(url ? { url } : {}),
            updatedAt: event.last_modified_time,
            license: source.license,
          },
        ],
        // Times and place are the calendar's own; the Classifier's answer sets this when it counts.
        confidence: 1,
        updatedAt: now.toISOString(),
      } satisfies Event,
    ];
  });
}

// The event's end, or start plus the Region's usual event length when it has none. An end at 23:59 local time is
// a placeholder many concerts get, not when they end.
function endOf(event: LinkedEvent, start: string, region: Region): string {
  const end = event.end_time;
  if (end && clockAt(end, region.timeZone) !== "23:59") return end;
  return new Date(new Date(start).getTime() + region.usualEventHours * HOUR_MS).toISOString();
}

// "19:30": the local time of day.
function clockAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

// "HIFK - Jokerit, jääkiekkoa · Helsingin jäähalli", per language; the venue in its own language where it has no
// name in that one.
function titleOf(name: LocalizedText, venue: LocalizedText): LocalizedText {
  const fallback = Object.values(venue)[0];
  return Object.fromEntries(Object.entries(name).map(([language, text]) => [language, [text, venue[language] ?? fallback].filter(Boolean).join(" · ")]));
}

// The calendar's texts without the empty ones it leaves in.
function textOf(text: LocalizedText | null): LocalizedText {
  return Object.fromEntries(Object.entries(text ?? {}).flatMap(([language, value]) => (value?.trim() ? [[language, value.trim()]] : [])));
}

function firstIn(text: LocalizedText | null, languages: string[]): string | undefined {
  const known = textOf(text);
  return languages.map((l) => known[l]).find(Boolean) ?? Object.values(known)[0];
}
