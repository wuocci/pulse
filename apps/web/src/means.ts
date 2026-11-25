import type { Event } from "@pulse/client";

// What an Event means for you, in a few plain words, by rules on what the Event already says (design round
// 2026-11-25): the second line of a row on Home, under what or where it is. Where the rules can only say something
// vague, a Classifier question may follow.

export type MeansKey =
  | "means_noService"
  | "means_lineChanges"
  | "means_crowds"
  | "means_eventNearby"
  | `means_arrangement_${NonNullable<Event["arrangementType"]>}`
  | "means_partlyBlocked"
  | "means_closedToCars"
  | "means_closed"
  | `means_who_${"drivers" | "cyclists" | "pedestrians" | "transit" | "parking" | "everyone"}`
  | "means_noisy"
  | "means_works";

export interface Means {
  key: MeansKey;
  // Lines named, for a transit alert.
  lines?: string;
  // Noisy as well, for works.
  noisy?: boolean;
}

export function meansOf(event: Event): Means {
  const noisy = event.noticeable.includes("noise");
  const lines = event.where.lineNames ?? [];

  if (event.kind === "disruption" && lines.length) {
    const named = lines.length <= 3 ? lines.join(", ") : `${lines.slice(0, 3).join(", ")} +${lines.length - 3}`;
    return { key: event.noticeable.includes("outage") ? "means_noService" : "means_lineChanges", lines: named };
  }
  if (event.kind === "public_event") return { key: event.noticeable.includes("crowd") ? "means_crowds" : "means_eventNearby" };
  // A traffic arrangement is published as a closure, but rarely closes the street: say what it changes.
  if (event.arrangementType && event.arrangementType !== "other") return { key: `means_arrangement_${event.arrangementType}` };
  if (event.arrangementType) return { key: event.noticeable.includes("blocked") ? "means_partlyBlocked" : "means_arrangement_other" };
  if (event.kind === "closure") return { key: event.mainlyAffected === "drivers" ? "means_closedToCars" : "means_closed" };

  const who = event.mainlyAffected;
  if (who !== "unknown" && who !== "nobody") return { key: `means_who_${who}`, noisy };
  if (noisy) return { key: "means_noisy" };
  return { key: event.noticeable.includes("blocked") ? "means_partlyBlocked" : "means_works" };
}
