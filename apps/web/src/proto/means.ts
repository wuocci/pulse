import type { Event } from "@pulse/client";

// What an Event means for you, in a few plain words, by rules on what the Event already says (design round
// 2026-11-25, Q13). A first draft for the prototype: where it comes out vague, a Classifier question may follow.

const ARRANGEMENT: Record<NonNullable<Event["arrangementType"]>, string> = {
  detour: "Detour: expect slower driving",
  walk_cycle_route: "Walk or cycle a different way",
  traffic_signs: "Temporary signs: take care",
  parking: "Fewer places to park",
  stop_moved: "Stop moved for a while",
  site_access: "Site traffic and fences",
  event: "Event traffic and crowds",
  other: "Traffic arranged differently",
};

const WHO: Record<Event["mainlyAffected"], string | undefined> = {
  drivers: "Lane narrowed: slower driving",
  cyclists: "Bike lane closed",
  pedestrians: "Sidewalk narrowed or closed",
  transit: "Changes to buses and trams",
  parking: "Fewer places to park",
  everyone: "Hard to get through",
  nobody: undefined,
  unknown: undefined,
};

export function meansOf(event: Event): string {
  const noisy = event.noticeable.includes("noise");
  const lines = event.where.lineNames ?? [];

  if (event.kind === "disruption" && lines.length) {
    const named = lines.length <= 3 ? lines.join(", ") : `${lines.slice(0, 3).join(", ")} and ${lines.length - 3} more`;
    return event.noticeable.includes("outage") ? `No service on ${named}` : `Changes on ${named}`;
  }
  if (event.kind === "public_event") return event.noticeable.includes("crowd") ? "Crowds: busy streets and trams" : "Event nearby";
  // A traffic arrangement is published as a closure, but rarely closes the street: say what it changes.
  if (event.arrangementType && event.arrangementType !== "other") return ARRANGEMENT[event.arrangementType];
  if (event.arrangementType) return event.noticeable.includes("blocked") ? "Street partly blocked" : ARRANGEMENT.other;
  if (event.kind === "closure") return event.mainlyAffected === "drivers" ? "Closed to cars: drive around" : "Closed: go around";

  const who = WHO[event.mainlyAffected];
  if (who) return noisy ? `${who} · noisy` : who;
  if (noisy) return "Noisy work nearby";
  return event.noticeable.includes("blocked") ? "Street partly blocked" : "Works nearby";
}
