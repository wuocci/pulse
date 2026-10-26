import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type DailyHours,
  type Event,
  EventKindSchema,
  EventSchema,
  EventStatusSchema,
  type EventStatus,
  LayerSchema,
  NoticeableSchema,
  type Weekday,
  WeekdaySchema,
} from "@pulse/schema";
import type { Region } from "../regions/index.ts";
import type { EventStore } from "./store.ts";

const DEFAULT_RADIUS_M = 1000;
const DEFAULT_STATUSES: EventStatus[] = ["active", "upcoming"];
// Right now is about what a person standing here can notice, so it looks close by.
const NOW_DEFAULT_RADIUS_M = 500;
const NOW_MAX_RADIUS_M = 2000;

// A comma-separated query value whose items must all parse with `item`.
function commaList<T extends z.ZodType>(item: T, message: string) {
  return z.string().transform((value, ctx) => {
    const parsed = z.array(item).safeParse(value.split(","));
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return parsed.data;
  });
}

const QuerySchema = z
  .object({
    near: z
      .string()
      .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?(,\d+)?$/, "Expected lat,lon or lat,lon,radiusInMetres")
      .optional()
      .openapi({
        example: "60.1699,24.9384,1000",
        description: `lat,lon[,radius in metres, default ${DEFAULT_RADIUS_M}; with layer=now ${NOW_DEFAULT_RADIUS_M}, at most ${NOW_MAX_RADIUS_M}]`,
      }),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    kind: EventKindSchema.optional(),
    status: commaList(EventStatusSchema, "Expected a comma-separated list of upcoming, active, resolved")
      .optional()
      .openapi({ example: "active,resolved", description: `Comma-separated; default ${DEFAULT_STATUSES.join(",")}` }),
    layer: LayerSchema.extract(["now"]).optional().openapi({
      description: [
        "now: the Right now lens. Needs `near`; returns only Events going on at this moment (time window and daily hours),",
        "noticeable ones first, then nearest first. Ignores `from` and `to`.",
      ].join(" "),
    }),
    noticeable: commaList(NoticeableSchema, "Expected a comma-separated list of noise, crowd, sirens, blocked, aircraft, outage")
      .optional()
      .openapi({ example: "noise,crowd", description: "Comma-separated; Events with any of them" }),
  })
  .superRefine(({ layer, near }, ctx) => {
    if (layer !== "now") return;
    if (!near) ctx.addIssue({ code: "custom", path: ["near"], message: "layer=now needs near" });
    else if (Number(near.split(",")[2] ?? 0) > NOW_MAX_RADIUS_M) {
      ctx.addIssue({ code: "custom", path: ["near"], message: `layer=now takes a radius of at most ${NOW_MAX_RADIUS_M} m` });
    }
  });

const route = createRoute({
  method: "get",
  path: "/events",
  request: { query: QuerySchema },
  responses: {
    200: {
      description: "Events matching the query",
      content: { "application/json": { schema: z.object({ events: z.array(EventSchema) }) } },
    },
  },
});

// `clock` is injected so "now" is testable.
export function eventRoutes(store: EventStore, regions: Region[], clock: () => Date) {
  return new OpenAPIHono().openapi(route, async (c) => {
    const { near, from, to, kind, status, layer, noticeable } = c.req.valid("query");
    const [lat, lon, radius] = near ? near.split(",").map(Number) : [];
    const filters = {
      ...(kind ? { kind } : {}),
      ...(noticeable ? { noticeable } : {}),
      statuses: status ?? DEFAULT_STATUSES,
    };

    if (layer === "now" && lat !== undefined && lon !== undefined) {
      const at = clock();
      const nearest = await store.query({
        ...filters,
        near: { lat, lon, radiusM: radius ?? NOW_DEFAULT_RADIUS_M },
        from: at,
        to: at,
        orderBy: "distance",
      });
      return c.json({ events: rightNow(nearest, at, regionAt(regions, lat, lon)) }, 200);
    }

    const events = await store.query({
      ...filters,
      ...(lat !== undefined && lon !== undefined ? { near: { lat, lon, radiusM: radius ?? DEFAULT_RADIUS_M } } : {}),
      ...(from ? { from: new Date(from) } : {}),
      ...(to ? { to: new Date(to) } : {}),
    });
    return c.json({ events }, 200);
  });
}

// Events don't belong to a Region, but daily hours are local time: the Region at the query point gives the zone
// and the default hours per kind. Outside every Region, hours are read in UTC and kinds have no defaults.
function regionAt(regions: Region[], lat: number, lon: number): Region | undefined {
  return regions.find(
    ({ bbox: [minLon, minLat, maxLon, maxLat] }) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat,
  );
}

// Keeps the Events whose daily hours contain `at`, already nearest first, and moves noticeable ones to the front.
function rightNow(nearest: Event[], at: Date, region: Region | undefined): Event[] {
  const local = localClock(at, region?.timeZone ?? "UTC");
  return nearest
    .filter((event) => withinDailyHours(local, event.when.dailyHours ?? region?.defaultDailyHours[event.kind]))
    .sort((a, b) => Number(b.noticeable.length > 0) - Number(a.noticeable.length > 0)); // stable: distance order stays
}

interface LocalClock {
  day: Weekday;
  minutes: number;
}

// The weekday and minutes since midnight at `at` in the given IANA time zone, summer time included.
// The inverse of `localTime` in the permit Adapter, with the same Intl lookup.
function localClock(at: Date, timeZone: string): LocalClock {
  const format = { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const parts = new Intl.DateTimeFormat("en-US", format).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return {
    day: WeekdaySchema.parse(part("weekday").toLowerCase()),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

// No hours means all day. Hours that end before they start run past midnight; `days` are the days they start on.
function withinDailyHours({ day, minutes }: LocalClock, hours: DailyHours | undefined): boolean {
  if (!hours) return true;
  const from = minutesOf(hours.from);
  const to = minutesOf(hours.to);
  const startsOn = (d: Weekday) => !hours.days || hours.days.includes(d);
  if (from <= to) return startsOn(day) && minutes >= from && minutes < to;
  return (minutes >= from && startsOn(day)) || (minutes < to && startsOn(previousDay(day)));
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

function previousDay(day: Weekday): Weekday {
  const week = WeekdaySchema.options;
  return week[(week.indexOf(day) + week.length - 1) % week.length]!;
}
