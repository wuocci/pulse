import type { Trip } from "@pulse/schema";
import type { CarParks } from "../adapters/digitransit-parking.ts";
import type { StreetParkingSource, StreetSpot, WeekHours } from "../adapters/street-parking.ts";
import { localClock } from "../events/hours.ts";
import type { ParkingFinder } from "./routes.ts";

// Parking around B on arrival by car: what street parking there is, and where to park — the closest spot you may
// use, the cheapest (free when it can be), and the car park with the most spaces. No data says what's free right
// now: the biggest car park is the likeliest to have room, and it's named for its size, not for room.

type ParkingPick = NonNullable<Trip["parking"]>["picks"][number];

const SUMMARY_M = 300;
const CLOSEST_M = 300;
const CHEAPEST_M = 500;
const SHORTEST_STAY_MIN = 60;

export interface ParkingFinderOptions {
  street?: StreetParkingSource;
  carParks?: CarParks;
  timeZone: string;
  credits: { street: string; carParks: string };
}

export function parkingFinder({ street, carParks, timeZone, credits }: ParkingFinderOptions): ParkingFinder {
  return {
    async near(point, arriveAt) {
      const [spots, parks] = await Promise.all([
        street?.around(point, CHEAPEST_M).catch(() => undefined),
        carParks?.near(point).catch(() => []) ?? [],
      ]);
      if (!spots?.length && !parks.length) return undefined;
      const clock = localClock(new Date(arriveAt), timeZone);
      const summary = spots && summarise(spots.filter((s) => s.distanceM <= SUMMARY_M), clock);
      const picks = [...streetPicks(spots ?? [], clock), ...biggest(parks)];
      const sources = [...(spots?.length ? [credits.street] : []), ...(parks.length ? [credits.carParks] : [])];
      return { ...(summary ? { street: summary } : {}), carParks: parks, sources, picks };
    },
  };
}

function summarise(spots: StreetSpot[], clock: Clock): NonNullable<Trip["parking"]>["street"] {
  if (!spots.length) return undefined;
  const sum = (filter: (s: StreetSpot) => boolean) => spots.filter(filter).reduce((total, s) => total + s.spaces, 0);
  return {
    spaces: sum(() => true),
    paid: sum((s) => s.kind === "paid"),
    free: sum((s) => s.kind === "free"),
    ev: sum((s) => s.type === "ev"),
    accessible: sum((s) => s.type === "accessible"),
    radiusM: SUMMARY_M,
    places: spots.map((spot) => {
      const { lat, lon, spaces, kind, type, maxStayMin, disc } = spot;
      const on = kind === "other" ? undefined : priced(spot, clock);
      return {
        lat,
        lon,
        spaces,
        kind,
        ...(type ? { type } : {}),
        ...(on ? costOf(on) : {}),
        ...(maxStayMin ? { maxStayMin } : {}),
        disc,
      };
    }),
  };
}

type Clock = ReturnType<typeof localClock>;
type Priced = { spot: StreetSpot; cost: "free" | "paid"; paidUntil?: string; freeUntil?: string };

function streetPicks(spots: StreetSpot[], clock: Clock): ParkingPick[] {
  const usable = spots
    .filter((s) => s.kind !== "other" && (s.maxStayMin ?? Infinity) >= SHORTEST_STAY_MIN && !within(s.noParkingHours, clock))
    .map((spot) => priced(spot, clock))
    .sort((a, b) => a.spot.distanceM - b.spot.distanceM);
  const closest = usable.find((p) => p.spot.distanceM <= CLOSEST_M);
  // The nearest at the lowest price known: free, else the fee zone's.
  const price = (p: Priced) => (p.cost === "free" ? 0 : (p.spot.perHour ?? Infinity));
  const cheapest = usable
    .filter((p) => p.spot.distanceM <= CHEAPEST_M && price(p) < Infinity)
    .reduce<Priced | undefined>((best, p) => (!best || price(p) < price(best) ? p : best), undefined);
  if (closest && closest === cheapest) return [pick(closest, ["closest", "cheapest"])];
  return [...(closest ? [pick(closest, ["closest"])] : []), ...(cheapest ? [pick(cheapest, ["cheapest"])] : [])];
}

// Free on arrival also when it's outside the paid hours.
function priced(spot: StreetSpot, clock: Clock): Priced {
  if (spot.kind === "free") return { spot, cost: "free" };
  if (!spot.paidHours) return { spot, cost: "paid" };
  const today = hoursOn(spot.paidHours, clock);
  if (today && clock.minutes >= today[0] && clock.minutes < today[1]) return { spot, cost: "paid", paidUntil: hhmm(today[1]) };
  return { spot, cost: "free", ...(today && clock.minutes < today[0] ? { freeUntil: hhmm(today[0]) } : {}) };
}

function costOf({ spot, cost, paidUntil, freeUntil }: Priced) {
  return {
    cost,
    ...(cost === "paid" && spot.perHour ? { perHour: spot.perHour } : {}),
    ...(paidUntil ? { paidUntil } : {}),
    ...(freeUntil ? { freeUntil } : {}),
  };
}

function pick(priced: Priced, reasons: ParkingPick["reasons"]): ParkingPick {
  const { spot } = priced;
  return {
    reasons,
    kind: "street",
    lat: spot.lat,
    lon: spot.lon,
    distanceM: spot.distanceM,
    spaces: spot.spaces,
    ...costOf(priced),
    ...(spot.maxStayMin ? { maxStayMin: spot.maxStayMin } : {}),
    disc: spot.disc,
  };
}

function biggest(parks: NonNullable<Trip["parking"]>["carParks"]): ParkingPick[] {
  const most = parks.reduce<(typeof parks)[number] | undefined>((best, p) => (!best || p.carSpaces > best.carSpaces ? p : best), undefined);
  if (!most) return [];
  const { name, lat, lon, distanceM, carSpaces } = most;
  return [{ reasons: ["biggest"], kind: "carPark", name, lat, lon, distanceM, spaces: carSpaces, cost: "unknown", disc: false }];
}

function hoursOn(hours: WeekHours, { day }: Clock): [number, number] | undefined {
  return day === "sat" ? hours.sat : day === "sun" ? hours.sun : hours.weekdays;
}

function within(hours: WeekHours | undefined, clock: Clock): boolean {
  const today = hours && hoursOn(hours, clock);
  return !!today && clock.minutes >= today[0] && clock.minutes < today[1];
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
