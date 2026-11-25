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
  };
}
