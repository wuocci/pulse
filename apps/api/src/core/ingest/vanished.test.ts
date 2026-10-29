import type { Event } from "@pulse/schema";
import { describe, expect, it } from "vitest";
import { keepVanished } from "./vanished.ts";

const now = new Date("2026-10-29T08:30:00+02:00");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const hoursAhead = (h: number) => hoursAgo(-h);

const alert = (id: string, when: Event["when"], status: Event["status"] = "active"): Event => ({
  id,
  kind: "disruption",
  layers: ["trips", "now"],
  title: { fi: id },
  where: { geometry: { type: "Point", coordinates: [24.93, 60.17] }, precision: "exact" },
  when,
  severity: "minor",
  mainlyAffected: "transit",
  noticeable: ["outage"],
  status,
  sources: [{ name: "Test", id, updatedAt: hoursAgo(1), license: "CC BY 4.0" }],
  confidence: 1,
  updatedAt: hoursAgo(1),
});

const keep = (previous: Event[], fresh: Event[]) => keepVanished(previous, fresh, { now, keepForHours: 24 });

describe("alerts that vanish from the feed", () => {
  it("are resolved as of now, ending now, so people see the all-clear", () => {
    const open = alert("open", { start: hoursAgo(5) });
    const later = alert("later", { start: hoursAgo(5), end: hoursAhead(48) });

    const events = keep([open, later], []);

    expect(events).toEqual([
      { ...open, status: "resolved", when: { start: open.when.start, end: now.toISOString() }, updatedAt: now.toISOString() },
      { ...later, status: "resolved", when: { start: later.when.start, end: now.toISOString() }, updatedAt: now.toISOString() },
    ]);
  });

  it("keep an end that has already passed", () => {
    const over = alert("over", { start: hoursAgo(5), end: hoursAgo(2) }, "resolved");

    expect(keep([over], [])[0]!.when.end).toBe(hoursAgo(2));
  });

  it("stay for the given hours after their end, then go", () => {
    const vanished = (h: number) => alert(`ended-${h}h-ago`, { start: hoursAgo(30), end: hoursAgo(h) }, "resolved");

    expect(keep([vanished(23.9), vanished(24)], []).map((e) => e.id)).toEqual(["ended-23.9h-ago"]);
  });

  it("go at once if they hadn't started: a cancelled alert has no all-clear to show", () => {
    expect(keep([alert("cancelled", { start: hoursAhead(2), end: hoursAhead(5) }, "upcoming")], [])).toEqual([]);
  });

  it("leave alerts still in the feed as the feed has them", () => {
    const before = alert("still-there", { start: hoursAgo(5) });
    const fresh = { ...before, title: { fi: "updated" } };

    expect(keep([before], [fresh])).toEqual([fresh]);
  });

  it("come back as the feed has them if they reappear", () => {
    const resolved = alert("back", { start: hoursAgo(5), end: hoursAgo(1) }, "resolved");
    const reappeared = alert("back", { start: hoursAgo(5) });

    expect(keep([resolved], [reappeared])).toEqual([reappeared]);
  });
});
