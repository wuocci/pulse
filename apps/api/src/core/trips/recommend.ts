import type { Impact, TravelMode } from "@pulse/schema";
import { RANK } from "./match.ts";

// "Better today" (PRD #34, #37): when the fastest way has something worth considering in it, the earliest way, in any
// mode, that's less in the way and arrives at most LATER_MS later. Less in the way, not faster: no delay data yet.

const LATER_MS = 10 * 60_000;

interface Planned {
  mode: TravelMode;
  itineraries: { end: string; impact: Impact }[];
}

export function recommend(plans: Planned[]): { mode: TravelMode; index: number } | undefined {
  const ways = plans
    .flatMap(({ mode, itineraries }) => itineraries.map(({ end, impact }, index) => ({ mode, index, end: Date.parse(end), impact })))
    .sort((a, b) => a.end - b.end);
  const fastest = ways[0];
  if (!fastest || RANK[fastest.impact] < RANK.consider) return undefined;
  const better = ways.find((way) => RANK[way.impact] < RANK[fastest.impact] && way.end <= fastest.end + LATER_MS);
  return better && { mode: better.mode, index: better.index };
}
