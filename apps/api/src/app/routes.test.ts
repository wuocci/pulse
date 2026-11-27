import type { Routine, RoutineInput } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { InMemoryEventStore } from "../core/events/store.ts";
import { regions } from "../core/regions/index.ts";
import { InMemoryAppStore, STALE_AFTER_MS } from "./store.ts";

// Synthetic places only: no real homes or workplaces.
const HOME = { lat: 60.17, lon: 24.95, name: "Home" };
const WORK = { lat: 60.199, lon: 24.933, name: "Work" };
const TRAM: RoutineInput["usual"] = {
  mode: "transit",
  itinerary: {
    start: "2026-11-30T08:00:00+02:00",
    end: "2026-11-30T08:22:00+02:00",
    durationS: 1320,
    legs: [],
    eventIds: [],
    onTheWay: [],
    comingUp: [],
    impact: "none",
  },
};
const COMMUTE: RoutineInput = {
  from: HOME,
  to: WORK,
  modes: ["transit", "bike"],
  days: { mon: { kind: "arriveBy", time: "09:00" }, fri: { kind: "leaveAt", time: "09:30" } },
  usual: TRAM,
};

function setup(start = new Date("2026-11-27T10:00:00Z")) {
  let now = start;
  const store = new InMemoryAppStore();
  const app = createApp({ db: { ping: async () => true }, events: new InMemoryEventStore(), regions, appStore: store, clock: () => now });
  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const register = async () => ((await (await app.request("/app/devices", { method: "POST" })).json()) as { id: string }).id;
  const as = (device: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string>), "X-Pulse-Device": device } });
  return { app, store, json, register, as, later: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("/app Devices", () => {
  it("registers an anonymous Device", async () => {
    const { app } = setup();
    const res = await app.request("/app/devices", { method: "POST" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: expect.any(String) });
  });

  it("turns away requests without a known Device", async () => {
    const { app, as } = setup();

    expect((await app.request("/app/routines")).status).toBe(401);
    expect((await app.request("/app/routines", as("not-a-device"))).status).toBe(401);
  });
});

describe("/app Routines", () => {
  it("saves a Routine with its weekday times and Usual route, and lists it", async () => {
    const { app, json, register, as } = setup();
    const device = await register();

    const created = await app.request("/app/routines", as(device, json(COMMUTE)));
    expect(created.status).toBe(201);
    const routine = (await created.json()) as Routine;
    expect(routine).toMatchObject({ ...COMMUTE, createdAt: "2026-11-27T10:00:00.000Z", renewedAt: "2026-11-27T10:00:00.000Z" });

    const list = await app.request("/app/routines", as(device));
    expect(await list.json()).toEqual({ routines: [routine] });
  });

  it("refuses a Routine without weekdays or with a time that isn't one", async () => {
    const { app, json, register, as } = setup();
    const device = await register();

    expect((await app.request("/app/routines", as(device, json({ ...COMMUTE, days: {} })))).status).toBe(400);
    expect((await app.request("/app/routines", as(device, json({ ...COMMUTE, days: { mon: { kind: "leaveAt", time: "25:00" } } })))).status).toBe(400);
  });

  it("changes and deletes a Routine", async () => {
    const { app, json, register, as } = setup();
    const device = await register();
    const { id } = (await (await app.request("/app/routines", as(device, json(COMMUTE)))).json()) as Routine;

    const changed = await app.request(`/app/routines/${id}`, as(device, { ...json({ ...COMMUTE, days: { tue: { kind: "leaveAt", time: "07:45" } } }), method: "PUT" }));
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as Routine).days).toEqual({ tue: { kind: "leaveAt", time: "07:45" } });

    expect((await app.request(`/app/routines/${id}`, as(device, { method: "DELETE" }))).status).toBe(204);
    expect(await (await app.request("/app/routines", as(device))).json()).toEqual({ routines: [] });
    expect((await app.request(`/app/routines/${id}`, as(device, { method: "DELETE" }))).status).toBe(404);
  });

  it("keeps each Device's Routines to itself", async () => {
    const { app, json, register, as } = setup();
    const mine = await register();
    const theirs = await register();
    const { id } = (await (await app.request("/app/routines", as(mine, json(COMMUTE)))).json()) as Routine;

    expect(await (await app.request("/app/routines", as(theirs))).json()).toEqual({ routines: [] });
    expect((await app.request(`/app/routines/${id}`, as(theirs, { ...json(COMMUTE), method: "PUT" }))).status).toBe(404);
    expect((await app.request(`/app/routines/${id}`, as(theirs, { method: "DELETE" }))).status).toBe(404);
  });
});

describe("/app renewal", () => {
  it("renews a Device's Routines when the app is opened", async () => {
    const { app, json, register, as, later } = setup();
    const device = await register();
    await app.request("/app/routines", as(device, json(COMMUTE)));

    later(30 * 86_400_000);
    expect((await app.request("/app/renew", as(device, { method: "POST" }))).status).toBe(204);

    const { routines } = (await (await app.request("/app/routines", as(device))).json()) as { routines: Routine[] };
    expect(routines[0]!.renewedAt).toBe("2026-12-27T10:00:00.000Z");
  });

  it("deletes Routines not renewed for 60 days, and keeps the rest", async () => {
    const { app, store, json, register, as, later } = setup();
    const gone = await register();
    const kept = await register();
    await app.request("/app/routines", as(gone, json(COMMUTE)));
    await app.request("/app/routines", as(kept, json(COMMUTE)));

    later(STALE_AFTER_MS - 86_400_000);
    await app.request("/app/renew", as(kept, { method: "POST" }));
    later(2 * 86_400_000);
    const now = new Date("2026-11-27T10:00:00Z").getTime() + STALE_AFTER_MS + 86_400_000;

    expect(await store.deleteStale(new Date(now - STALE_AFTER_MS))).toBe(1);
    expect((await app.request("/app/routines", as(gone))).status).toBe(401);
    expect(await (await app.request("/app/routines", as(kept))).json()).toEqual({ routines: [expect.objectContaining({ from: HOME })] });
  });
});
