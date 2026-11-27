import type { Region, Trip } from "@pulse/client";
import type { Routine, RoutineInput } from "@pulse/schema";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { Platform } from "./platform.tsx";
import { dayRuns, NoUsualRoute, nextOccurrence, withUsualRoute } from "./routines.ts";

// The map draws with WebGL, which jsdom lacks; these tests are about Routines.
vi.mock("./map/PointMap.tsx", () => ({ PointMap: () => <div data-testid="map" /> }));

const TZ = "Europe/Helsinki";
const region: Region = { id: "test-region", name: { en: "Test region" }, bbox: [24.4, 60.0, 25.3, 60.45], timeZone: TZ, languages: ["fi", "sv", "en"] };
// Synthetic places only.
const HOME = { lat: 60.17, lon: 24.95, name: "Home" };
const WORK = { lat: 60.199, lon: 24.933, name: "Work" };

const itinerary = (start: string, end: string, legs: Trip["plans"][number]["itineraries"][number]["legs"] = []) => ({
  start,
  end,
  durationS: (Date.parse(end) - Date.parse(start)) / 1000,
  legs,
  eventIds: [],
  onTheWay: [],
  comingUp: [],
  impact: "none" as const,
});

// What /app holds, per test: Routines by id, and the Device ids it knows.
let routines: Map<string, Routine>;
let devices: Set<string>;
let renewed: string[];
let tripAsked: URLSearchParams[];
let tripAnswer: Trip;
// The bodies /app was sent to save, and how.
let saved: { method: string; body: RoutineInput }[];

const server = setupServer(
  http.get("*/v0/regions", () => HttpResponse.json({ regions: [region] })),
  http.get("*/v0/events", () => HttpResponse.json({ events: [] })),
  http.get("*/v0/geocode", () => HttpResponse.json({ results: [] })),
  http.get("*/v0/trips", ({ request }) => {
    tripAsked.push(new URL(request.url).searchParams);
    return HttpResponse.json(tripAnswer);
  }),
  http.post("*/app/devices", () => {
    devices.add("device-1");
    return HttpResponse.json({ id: "device-1" }, { status: 201 });
  }),
  http.post("*/app/renew", ({ request }) => {
    const device = request.headers.get("X-Pulse-Device");
    if (!device || !devices.has(device)) return HttpResponse.json({ message: "unknown" }, { status: 401 });
    renewed.push(device);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("*/app/routines", ({ request }) =>
    devices.has(request.headers.get("X-Pulse-Device") ?? "") ? HttpResponse.json({ routines: [...routines.values()] }) : HttpResponse.json({ message: "unknown" }, { status: 401 }),
  ),
  http.post("*/app/routines", async ({ request }) => {
    const body = (await request.json()) as RoutineInput;
    saved.push({ method: "POST", body });
    const made = { ...body, id: `r${routines.size + 1}`, createdAt: "2026-11-27T10:00:00.000Z", renewedAt: "2026-11-27T10:00:00.000Z" };
    routines.set(made.id, made);
    return HttpResponse.json(made, { status: 201 });
  }),
  http.put("*/app/routines/:id", async ({ request, params }) => {
    const body = (await request.json()) as RoutineInput;
    saved.push({ method: "PUT", body });
    const changed = { ...routines.get(String(params.id))!, ...body };
    routines.set(changed.id, changed);
    return HttpResponse.json(changed);
  }),
  http.delete("*/app/routines/:id", ({ params }) => {
    routines.delete(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  routines = new Map();
  devices = new Set();
  renewed = [];
  tripAsked = [];
  tripAnswer = { events: [], plans: [] };
  saved = [];
});

function fakePlatform(stored: Record<string, string> = {}) {
  const storage = new Map(Object.entries(stored));
  const platform: Platform = {
    location: {
      current: async () => {
        throw new Error("no location");
      },
      watch: () => () => {},
      allowed: async () => false,
    },
    storage: { get: async (key) => storage.get(key) ?? null, set: async (key, value) => void storage.set(key, value) },
  };
  return { platform, storage };
}

const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: "r1",
  from: HOME,
  to: WORK,
  modes: ["transit"],
  days: { mon: { kind: "arriveBy", time: "09:00" }, tue: { kind: "arriveBy", time: "09:00" }, wed: { kind: "arriveBy", time: "09:00" }, fri: { kind: "leaveAt", time: "09:30" } },
  usual: { mode: "transit", itinerary: itinerary("2026-11-30T08:30:00+02:00", "2026-11-30T08:52:00+02:00") },
  createdAt: "2026-11-27T10:00:00.000Z",
  renewedAt: "2026-11-27T10:00:00.000Z",
  ...patch,
});

describe("a Routine's next time", () => {
  it("is later today when today's time hasn't passed, on the Region's clock", () => {
    // Friday 27.11.2026 07:00 in Helsinki.
    const next = nextOccurrence({ fri: { kind: "leaveAt", time: "08:15" } }, new Date("2026-11-27T05:00:00Z"), TZ);
    expect(next?.at.toISOString()).toBe("2026-11-27T06:15:00.000Z");
  });

  it("is the next day it runs once today's time has passed", () => {
    const next = nextOccurrence({ mon: { kind: "arriveBy", time: "09:00" }, fri: { kind: "leaveAt", time: "08:15" } }, new Date("2026-11-27T07:00:00Z"), TZ);
    expect(next).toEqual({ at: new Date("2026-11-30T07:00:00Z"), time: { kind: "arriveBy", time: "09:00" } });
  });

  it("keeps the local time across a change to summer time", () => {
    // Sunday 28.3.2027 is when Finland moves to UTC+3; Monday 29.3. 08:00 is then 05:00 UTC.
    const next = nextOccurrence({ mon: { kind: "leaveAt", time: "08:00" } }, new Date("2027-03-27T12:00:00Z"), TZ);
    expect(next?.at.toISOString()).toBe("2027-03-29T05:00:00.000Z");
  });

  it("is a week ahead when only today runs and its time has passed", () => {
    const next = nextOccurrence({ fri: { kind: "leaveAt", time: "06:00" } }, new Date("2026-11-27T05:00:00Z"), TZ);
    expect(next?.at.toISOString()).toBe("2026-12-04T04:00:00.000Z");
  });
});

describe("a Routine's days in words", () => {
  it("joins runs of days with the same time", () => {
    expect(dayRuns(routine().days)).toEqual([
      { from: "mon", to: "wed", time: { kind: "arriveBy", time: "09:00" } },
      { from: "fri", to: "fri", time: { kind: "leaveAt", time: "09:30" } },
    ]);
  });
});

describe("the Usual route", () => {
  it("is the fastest way at the Routine's next time, in its modes", async () => {
    const tram = itinerary("2026-11-30T08:30:00+02:00", "2026-11-30T08:52:00+02:00");
    const bike = itinerary("2026-11-30T08:25:00+02:00", "2026-11-30T08:58:00+02:00");
    tripAnswer = { events: [], plans: [{ mode: "transit", itineraries: [tram] }, { mode: "bike", itineraries: [bike] }] };
    const draft = { from: HOME, to: WORK, modes: ["transit", "bike"] as RoutineInput["modes"], days: { mon: { kind: "arriveBy" as const, time: "09:00" } } };

    const input = await withUsualRoute(draft, { now: new Date("2026-11-27T10:00:00Z"), timeZone: TZ, speeds: { walk: 5 } });

    expect(input.usual).toEqual({ mode: "transit", itinerary: tram });
    const asked = tripAsked.at(-1)!;
    expect(asked.get("arriveBy")).toBe("2026-11-30T07:00:00.000Z");
    expect(asked.get("modes")).toBe("transit,bike");
    expect(asked.get("walkSpeed")).toBe("5");
  });

  it("can't be picked when there's no way at that time", async () => {
    const draft = { from: HOME, to: WORK, modes: ["transit"] as RoutineInput["modes"], days: { mon: { kind: "leaveAt" as const, time: "03:00" } } };
    await expect(withUsualRoute(draft, { now: new Date("2026-11-27T10:00:00Z"), timeZone: TZ })).rejects.toBeInstanceOf(NoUsualRoute);
  });
});

describe("Your trips in Settings", () => {
  it("lists your Routines with their days and times, and removes one", async () => {
    devices.add("device-1");
    routines.set("r1", routine());
    render(<App platform={fakePlatform({ device: "device-1" }).platform} history={createMemoryHistory({ initialEntries: ["/settings"] })} />);

    const trips = within(await screen.findByRole("region", { name: "Your trips" }));
    expect(await trips.findByText("Home → Work")).toBeInTheDocument();
    expect(trips.getByText("Mon–Wed arrive by 09:00 · Fri leave 09:30")).toBeInTheDocument();

    await userEvent.click(trips.getByRole("button", { name: "Remove Home → Work" }));
    await waitFor(() => expect(trips.queryByText("Home → Work")).not.toBeInTheDocument());
    expect(routines.size).toBe(0);
  });

  it("says how to make one when there are none, without registering a Device", async () => {
    const { platform, storage } = fakePlatform();
    render(<App platform={platform} history={createMemoryHistory({ initialEntries: ["/settings"] })} />);

    const trips = within(await screen.findByRole("region", { name: "Your trips" }));
    expect(await trips.findByText(/None yet/)).toBeInTheDocument();
    expect(storage.has("device")).toBe(false);
    expect(devices.size).toBe(0);
  });
});

describe("opening the app", () => {
  it("renews this phone's Routines", async () => {
    devices.add("device-1");
    render(<App platform={fakePlatform({ device: "device-1" }).platform} history={createMemoryHistory({ initialEntries: ["/"] })} />);
    await waitFor(() => expect(renewed).toEqual(["device-1"]));
  });

  it("asks nothing of /app on a phone without Routines", async () => {
    render(<App platform={fakePlatform().platform} history={createMemoryHistory({ initialEntries: ["/"] })} />);
    await screen.findByRole("button", { name: /Where to\?/ });
    expect(renewed).toEqual([]);
    expect(devices.size).toBe(0);
  });
});

describe("making a Trip a usual trip", () => {
  const places = JSON.stringify([HOME, WORK]);
  const tripTo = (extra = "") =>
    createMemoryHistory({ initialEntries: [`/?at=${HOME.lat.toFixed(5)},${HOME.lon.toFixed(5)}&trip=true&to=${WORK.lat.toFixed(5)},${WORK.lon.toFixed(5)}&toName=Work${extra}`] });
  const tram = itinerary("2026-11-30T08:30:00+02:00", "2026-11-30T08:52:00+02:00");

  it("runs on workdays at the Trip's time, the days and times yours to change", async () => {
    tripAnswer = { events: [], plans: [{ mode: "transit", itineraries: [tram] }] };
    const { platform, storage } = fakePlatform({ places });
    render(<App platform={platform} history={tripTo("&time=2026-11-30T09:00&arrive=true")} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Make this a usual trip" }));
    const form = within(screen.getByRole("form", { name: "Make Home → Work a usual trip" }));
    expect(form.getByRole("checkbox", { name: "Monday" })).toBeChecked();
    expect(form.getByRole("checkbox", { name: "Saturday" })).not.toBeChecked();
    expect(form.getByRole("combobox", { name: "Friday: leave at or arrive by" })).toHaveValue("arriveBy");
    expect(form.getByLabelText("Friday: time")).toHaveValue("09:00");

    await user.click(form.getByRole("checkbox", { name: "Wednesday" }));
    await user.selectOptions(form.getByRole("combobox", { name: "Friday: leave at or arrive by" }), "leaveAt");
    await user.click(form.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved to your trips.")).toBeInTheDocument();
    expect(saved).toHaveLength(1);
    const body = saved[0]!.body;
    expect(body.from).toEqual(HOME);
    expect(body.to).toEqual(WORK);
    expect(body.days).toEqual({
      mon: { kind: "arriveBy", time: "09:00" },
      tue: { kind: "arriveBy", time: "09:00" },
      thu: { kind: "arriveBy", time: "09:00" },
      fri: { kind: "leaveAt", time: "09:00" },
    });
    expect(body.usual).toEqual({ mode: "transit", itinerary: tram });
    // The Device was made for it, and kept.
    expect(storage.get("device")).toBe("device-1");
    expect(await screen.findByRole("button", { name: "Change this usual trip" })).toBeInTheDocument();
  });

  it("says so when there's no way at that time, and saves nothing", async () => {
    const { platform } = fakePlatform({ places });
    tripAnswer = { events: [], plans: [{ mode: "transit", itineraries: [tram] }] };
    render(<App platform={platform} history={tripTo()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Make this a usual trip" }));
    tripAnswer = { events: [], plans: [] };
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No way found at that time");
    expect(saved).toEqual([]);
  });

  it("changes a usual trip's days from Settings", async () => {
    devices.add("device-1");
    routines.set("r1", routine());
    tripAnswer = { events: [], plans: [{ mode: "transit", itineraries: [tram] }] };
    render(<App platform={fakePlatform({ device: "device-1" }).platform} history={createMemoryHistory({ initialEntries: ["/settings"] })} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Change Home → Work" }));
    const form = within(screen.getByRole("form", { name: "Change Home → Work" }));
    await user.click(form.getByRole("checkbox", { name: "Saturday" }));
    await user.click(form.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saved.map((s) => s.method)).toEqual(["PUT"]));
    // A day ticked takes the last time set.
    expect(saved[0]!.body.days.sat).toEqual({ kind: "leaveAt", time: "09:30" });
    expect(await screen.findByText(/Sat leave 09:30/)).toBeInTheDocument();
  });
});
