import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRegions } from "./api.ts";
import { type LatLon, usePlatform } from "./platform.tsx";

// The point the app is looking around: from the URL (a shared link, a reload), else the one remembered on the
// device, else the Region's centre. Changing it updates both the URL and the device.

const STORAGE_KEY = "point";
const AT = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;

export function parseAt(at: string | null | undefined): LatLon | undefined {
  const match = at ? AT.exec(at) : null;
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}

// Five decimals: about a metre, enough for a location and short in a URL.
export function formatAt({ lat, lon }: LatLon): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

// openapi-fetch's response types widen the bbox tuple to number[], so it's checked here.
function centreOf({ bbox }: { bbox: number[] }): LatLon | undefined {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (minLon === undefined || minLat === undefined || maxLon === undefined || maxLat === undefined) return undefined;
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

export function usePoint(): { point: LatLon | undefined; setPoint: (point: LatLon) => void } {
  const { storage } = usePlatform();
  const queryClient = useQueryClient();
  const { at } = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const regions = useRegions();
  const stored = useQuery({ queryKey: ["stored-point"], queryFn: () => storage.get(STORAGE_KEY), staleTime: Infinity });

  const fallback = regions.data?.[0] ? centreOf(regions.data[0]) : undefined;
  const point = parseAt(at) ?? (stored.isPending ? undefined : (parseAt(stored.data) ?? fallback));

  const setPoint = (next: LatLon) => {
    const value = formatAt(next);
    void navigate({ search: (prev) => ({ ...prev, at: value }), replace: true });
    queryClient.setQueryData(["stored-point"], value);
    void storage.set(STORAGE_KEY, value);
  };

  return { point, setPoint };
}
