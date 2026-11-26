import type { Impact, TravelMode } from "@pulse/schema";
import { RANK } from "./match.ts";

// "Better today" (PRD #34, #37): when the plain best way has something worth considering in it, the next best way,
// in any mode, that's less in the way and costs at most COST_MS more. Less in the way, not faster: no delay data yet.
// What a way costs depends on what was asked: leaving at a time, a later arrival; arriving by a time, an earlier
// departure (every way arrives in time, so arriving first only means waiting at the end).

const COST_MS = 10 * 60_000;

interface Planned {
  mode: TravelMode;
  itineraries: { start: string; end: string; impact: Impact }[];
}

export function recommend(plans: Planned[], { arriveBy = false }: { arriveBy?: boolean } = {}): { mode: TravelMode; index: number } | undefined {
  const ways = plans
    .flatMap(({ mode, itineraries }) => itineraries.map(({ start, end, impact }, index) => ({ mode, index, start: Date.parse(start), end: Date.parse(end), impact })))
    // Leaving at a time: the earliest arrival, then the later departure. Arriving by one: the reverse.
    .sort((a, b) => (arriveBy ? b.start - a.start || a.end - b.end : a.end - b.end || b.start - a.start));
  const best = ways[0];
  if (!best || RANK[best.impact] < RANK.consider) return undefined;
  const costs = (way: (typeof ways)[number]) => (arriveBy ? best.start - way.start : way.end - best.end);
  const better = ways.find((way) => RANK[way.impact] < RANK[best.impact] && costs(way) <= COST_MS);
  return better && { mode: better.mode, index: better.index };
}
