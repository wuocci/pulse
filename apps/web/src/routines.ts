import type { TravelMode } from "@pulse/client";
import type { Routine, RoutineInput, RoutineTime, Weekday } from "@pulse/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { planTrip } from "./api.ts";
import { type DeviceStorage, type LatLon, usePlatform } from "./platform.tsx";
import { fastestOf, itineraryOf } from "./trips.ts";

// Routines (CONTEXT.md): your usual trips, saved on the server under this phone's anonymous Device (ADR 0013), so
// Pulse can check them before you leave. /app is the app's own API, beside the public /v0 (ADR 0010).

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DEVICE_KEY = "device";
const DEVICE_HEADER = "X-Pulse-Device";
const base = () => import.meta.env.VITE_API_URL || window.location.origin;

// This phone's Device, registered the first time a Routine needs it. None until then: browsing needs no Device.
async function deviceId(storage: DeviceStorage, register: boolean): Promise<string | undefined> {
  const stored = await storage.get(DEVICE_KEY);
  if (stored || !register) return stored ?? undefined;
  const res = await fetch(`${base()}/app/devices`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /app/devices responded ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  await storage.set(DEVICE_KEY, id);
  return id;
}

async function call(storage: DeviceStorage, path: string, init: RequestInit = {}, register = false): Promise<Response | undefined> {
  const id = await deviceId(storage, register);
  if (!id) return undefined;
  const res = await fetch(`${base()}/app${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), [DEVICE_HEADER]: id },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} /app${path} responded ${res.status}`);
  return res;
}

export function useRoutines() {
  const { storage } = usePlatform();
  const queryClient = useQueryClient();
  const routines = useQuery({
    queryKey: ["routines"],
    queryFn: async () => {
      const res = await call(storage, "/routines");
      return res ? ((await res.json()) as { routines: Routine[] }).routines : [];
    },
    staleTime: 60_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["routines"] });
  const save = useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: RoutineInput }) =>
      call(storage, id ? `/routines/${id}` : "/routines", { method: id ? "PUT" : "POST", body: JSON.stringify(input) }, true),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => call(storage, `/routines/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  return { routines: routines.data, save, remove };
}

// Opening the app says its Routines are still in use; unused for 60 days, they're deleted (ADR 0013).
export function useRenewRoutines() {
  const { storage } = usePlatform();
  useEffect(() => {
    void call(storage, "/renew", { method: "POST" }).catch(() => {
      // Not renewed this time; the next opening tries again.
    });
  }, [storage]);
}

// A date and time on the Region's clock, as the instant it is.
function zonedInstant(date: { y: number; m: number; d: number }, time: string, timeZone: string): Date {
  const [h, min] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(date.y, date.m - 1, date.d, h, min);
  // How far the zone is from UTC at about that moment; then once more at the corrected one, for a day DST changes.
  const offsetAt = (at: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(at))
        .map(({ type, value }) => [type, value]),
    );
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - at;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

// The Routine's next time after `now`: the day, and the time on it to leave at or arrive by. Undefined without days.
export function nextOccurrence(days: Partial<Record<Weekday, RoutineTime>>, now: Date, timeZone: string): { at: Date; time: RoutineTime } | undefined {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" });
  for (let ahead = 0; ahead <= 7; ahead++) {
    const p = Object.fromEntries(day.formatToParts(new Date(now.getTime() + ahead * 86_400_000)).map(({ type, value }) => [type, value]));
    const weekday = p.weekday!.toLowerCase().slice(0, 3) as Weekday;
    const time = days[weekday];
    if (!time) continue;
    const at = zonedInstant({ y: Number(p.year), m: Number(p.month), d: Number(p.day) }, time.time, timeZone);
    if (at > now) return { at, time };
  }
  return undefined;
}

export interface RoutineDraft {
  from: LatLon & { name: string };
  to: LatLon & { name: string };
  modes: TravelMode[];
  days: Partial<Record<Weekday, RoutineTime>>;
}

// The Usual route (CONTEXT.md): the plain fastest way at the Routine's next time, in its modes and at your speeds.
// Picked here with the same rule the Trip view uses, so "usual" means what the app shows as the fastest.
export async function withUsualRoute(draft: RoutineDraft, { now, timeZone, speeds }: { now: Date; timeZone: string; speeds?: { walk?: number; bike?: number } }): Promise<RoutineInput> {
  const next = nextOccurrence(draft.days, now, timeZone);
  if (!next) throw new Error("A Routine needs at least one day");
  const arrive = next.time.kind === "arriveBy";
  const trip = await planTrip(draft.from, draft.to, next.at, { arrive, modes: draft.modes, ...(speeds ? { speeds } : {}) });
  const way = fastestOf({ ...trip, walkKmh: speeds?.walk, arriveBy: arrive ? next.at.getTime() : undefined });
  const itinerary = itineraryOf(trip, way);
  if (!way || !itinerary) throw new NoUsualRoute();
  return { ...draft, usual: { mode: way.mode, itinerary } };
}

export class NoUsualRoute extends Error {
  constructor() {
    super("No way found at the Routine's time");
  }
}

// Whether a Routine goes between these two places, each the same spot to about 10 m.
export function sameEnds(routine: Pick<Routine, "from" | "to">, ends: { from: LatLon; to: LatLon }): boolean {
  const near = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 2e-4;
  return near(routine.from, ends.from) && near(routine.to, ends.to);
}

// A Routine's days in a few words: runs of days with the same time joined, "Mon–Thu", then the time.
export function dayRuns(days: Partial<Record<Weekday, RoutineTime>>): { from: Weekday; to: Weekday; time: RoutineTime }[] {
  const runs: { from: Weekday; to: Weekday; time: RoutineTime }[] = [];
  let last: Weekday | undefined;
  for (const day of WEEKDAYS) {
    const time = days[day];
    const run = runs.at(-1);
    if (time && run && last && WEEKDAYS.indexOf(day) === WEEKDAYS.indexOf(last) + 1 && run.time.kind === time.kind && run.time.time === time.time) run.to = day;
    else if (time) runs.push({ from: day, to: day, time });
    last = time ? day : undefined;
  }
  return runs;
}
