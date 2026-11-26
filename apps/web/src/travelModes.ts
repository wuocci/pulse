import type { TravelMode } from "@pulse/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePlatform } from "./platform.tsx";

// The ways you travel (design round 2026-11-25): set once, on the phone; a Trip is planned and recommended only in
// these. Every mode until set.

export const ALL_MODES: TravelMode[] = ["transit", "walk", "bike", "car"];
const KEY = "modes";

// The stored modes, in the usual order; every mode when none or anything malformed is stored.
export function parseModes(value: string | null): TravelMode[] {
  try {
    const list: unknown = value ? JSON.parse(value) : undefined;
    const modes = Array.isArray(list) ? ALL_MODES.filter((m) => list.includes(m)) : [];
    return modes.length ? modes : ALL_MODES;
  } catch {
    return ALL_MODES;
  }
}

export function useTravelModes(): { modes: TravelMode[] | undefined; toggle: (mode: TravelMode) => void } {
  const { storage } = usePlatform();
  const queryClient = useQueryClient();
  const stored = useQuery({ queryKey: ["modes"], queryFn: async () => parseModes(await storage.get(KEY)), staleTime: Infinity });
  return {
    modes: stored.data,
    // The last mode stays: a Trip needs one.
    toggle: (mode) => {
      const current = queryClient.getQueryData<TravelMode[]>(["modes"]) ?? ALL_MODES;
      const next = current.includes(mode) ? current.filter((m) => m !== mode) : ALL_MODES.filter((m) => m === mode || current.includes(m));
      if (!next.length) return;
      queryClient.setQueryData(["modes"], next);
      void storage.set(KEY, JSON.stringify(next));
    },
  };
}

// How fast you walk and cycle, km/h: set with the ways you travel. Unset, Digitransit's own (about these) is used.
export type Speeds = { walk?: number; bike?: number };
export const SPEED_RANGE = { walk: { min: 3, max: 7, step: 0.5, usual: 5 }, bike: { min: 10, max: 30, step: 1, usual: 18 } } as const;
const SPEEDS_KEY = "speeds";

export function parseSpeeds(value: string | null): Speeds {
  try {
    const stored: unknown = value ? JSON.parse(value) : undefined;
    const speeds: Speeds = {};
    for (const mode of ["walk", "bike"] as const) {
      const kmh = (stored as Record<string, unknown> | undefined)?.[mode];
      const { min, max } = SPEED_RANGE[mode];
      if (typeof kmh === "number" && kmh >= min && kmh <= max) speeds[mode] = kmh;
    }
    return speeds;
  } catch {
    return {};
  }
}

export function useSpeeds(): { speeds: Speeds | undefined; set: (mode: keyof Speeds, kmh: number) => void } {
  const { storage } = usePlatform();
  const queryClient = useQueryClient();
  const stored = useQuery({ queryKey: ["speeds"], queryFn: async () => parseSpeeds(await storage.get(SPEEDS_KEY)), staleTime: Infinity });
  return {
    speeds: stored.data,
    set: (mode, kmh) => {
      const next = { ...(queryClient.getQueryData<Speeds>(["speeds"]) ?? {}), [mode]: kmh };
      queryClient.setQueryData(["speeds"], next);
      void storage.set(SPEEDS_KEY, JSON.stringify(next));
    },
  };
}
