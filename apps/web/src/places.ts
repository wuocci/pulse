import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type LatLon, usePlatform } from "./platform.tsx";

// Your places (Home, Work, …): kept on the phone, no account (ADR 0001). Home checks each for what changes plans
// near it, and each is a one-tap destination.

export interface SavedPlace extends LatLon {
  name: string;
}

const KEY = "places";
export const MAX_PLACES = 5;

// The stored list, or none: anything malformed is dropped rather than failing Home.
export function parsePlaces(value: string | null): SavedPlace[] {
  try {
    const list: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (p): p is SavedPlace =>
          !!p && typeof p === "object" && typeof p.name === "string" && p.name.trim() !== "" && Number.isFinite(p.lat) && Number.isFinite(p.lon),
      )
      .map(({ name, lat, lon }) => ({ name, lat, lon }))
      .slice(0, MAX_PLACES);
  } catch {
    return [];
  }
}

export function usePlaces(): {
  places: SavedPlace[] | undefined;
  add: (place: SavedPlace) => void;
  remove: (name: string) => void;
  rename: (from: string, to: string) => void;
} {
  const { storage } = usePlatform();
  const queryClient = useQueryClient();
  const stored = useQuery({ queryKey: ["places"], queryFn: async () => parsePlaces(await storage.get(KEY)), staleTime: Infinity });

  const save = (next: SavedPlace[]) => {
    queryClient.setQueryData(["places"], next);
    void storage.set(KEY, JSON.stringify(next));
  };
  const current = () => queryClient.getQueryData<SavedPlace[]>(["places"]) ?? [];

  return {
    places: stored.data,
    // A place with the same name is replaced: saving Home again moves it.
    add: (place) => save([...current().filter((p) => p.name !== place.name), place].slice(0, MAX_PLACES)),
    remove: (name) => save(current().filter((p) => p.name !== name)),
    // In its place in the list; a place already called that gives way, so renaming to Home makes it Home.
    rename: (from, to) => save(current().flatMap((p) => (p.name === from ? [{ ...p, name: to }] : p.name === to ? [] : [p]))),
  };
}

// The saved place at a point, if any: the same spot to about 10 m.
export function savedAt(places: SavedPlace[] | undefined, at: LatLon | undefined): SavedPlace | undefined {
  if (!at) return undefined;
  return places?.find((p) => Math.abs(p.lat - at.lat) < 1e-4 && Math.abs(p.lon - at.lon) < 2e-4);
}

// The names offered first, in order, until they're used.
export const USUAL_NAMES = ["Home", "Work"] as const;
