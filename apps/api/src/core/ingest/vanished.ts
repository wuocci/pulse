import type { Event } from "@pulse/schema";

// Feeds like GTFS-RT drop an alert once it's over. Instead of letting it disappear, the Event is resolved as of
// the moment it vanished and stays for a while, so people see the all-clear. Set per Source (`keepVanishedHours`).

export function keepVanished(previous: Event[], fresh: Event[], { now, keepForHours }: { now: Date; keepForHours: number }): Event[] {
  const inFeed = new Set(fresh.map((e) => e.id));
  const vanished = previous.flatMap((event) => {
    if (inFeed.has(event.id)) return [];
    // Never started: cancelled, nothing to give the all-clear for.
    if (new Date(event.when.start) > now) return [];
    const end = event.when.end && new Date(event.when.end) <= now ? event.when.end : now.toISOString();
    if (now.getTime() - new Date(end).getTime() >= keepForHours * 3_600_000) return [];
    if (event.status === "resolved" && end === event.when.end) return [event];
    return [{ ...event, status: "resolved" as const, when: { ...event.when, end }, updatedAt: now.toISOString() }];
  });
  return [...fresh, ...vanished];
}
