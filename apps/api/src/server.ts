import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { classifierConfig, createPool, digitransitApiKey } from "./config.ts";
import { digitransitDirectory } from "./core/adapters/digitransit.ts";
import { digitransitGeocoder, type Geocoder } from "./core/adapters/digitransit-geocoding.ts";
import { digitransitCarParks } from "./core/adapters/digitransit-parking.ts";
import { digitransitRouter, type Router } from "./core/adapters/digitransit-routing.ts";
import { helsinkiStreetParking } from "./core/adapters/street-parking.ts";
import type { ParkingFinder } from "./core/trips/routes.ts";
import type { StopDirectory } from "./core/adapters/gtfs-rt.ts";
import { PgAnswerCache } from "./core/classifier/cache.ts";
import { Classification } from "./core/classifier/enrich.ts";
import { createJevClassifier } from "./core/classifier/jev.ts";
import { InMemoryEventStore } from "./core/events/store.ts";
import { startIngest } from "./core/ingest/scheduler.ts";
import { type GtfsRtSource, type Region, regions } from "./core/regions/index.ts";
import { runMigrations } from "./db.ts";

const pool = createPool();

// Migrations run before anything uses the database. An unreachable database doesn't stop the API:
// it still serves Events, and /health reports the database as down.
const migrated = await runMigrations(pool).then(
  () => true,
  (error: unknown) => {
    console.error("Database migrations failed:", error instanceof Error ? error.message : error);
    return false;
  },
);

const events = new InMemoryEventStore();

// Classification needs the answer cache: without it, every restart would ask the Classifier about every text again.
const classifier = classifierConfig();
const classification =
  classifier && migrated
    ? new Classification({
        classifier: createJevClassifier(classifier),
        cache: new PgAnswerCache(pool),
        store: events,
        threshold: classifier.threshold,
      })
    : undefined;
if (!classifier) console.log("Classifier off: TYPESAFE_API_KEY not set");
else if (!classification) console.log("Classifier off: no database for its cache");
else console.log(`Classifier on: ${classifier.model}, threshold ${classifier.threshold}`);

// One directory per GTFS-RT Source, kept across refreshes so its cache lasts.
const digitransitKey = digitransitApiKey();
const directories = new Map<string, StopDirectory>();
const stopDirectory = digitransitKey
  ? (source: GtfsRtSource) => {
      let directory = directories.get(source.id);
      if (!directory) {
        directory = digitransitDirectory({ url: source.directory.url, apiKey: digitransitKey });
        directories.set(source.id, directory);
      }
      return directory;
    }
  : undefined;
if (!digitransitKey) console.log("Stop directory off: DIGITRANSIT_API_KEY not set");

// One geocoder per Region that names one; the same key as the stop directory.
const geocoders = new Map<string, Geocoder>();
const geocoderFor = digitransitKey
  ? (region: Region) => {
      if (region.geocoder?.kind !== "digitransit") return undefined;
      let geocoder = geocoders.get(region.id);
      if (!geocoder) {
        geocoder = digitransitGeocoder({ url: region.geocoder.url, apiKey: digitransitKey });
        geocoders.set(region.id, geocoder);
      }
      return geocoder;
    }
  : undefined;
if (!digitransitKey) console.log("Address search off: DIGITRANSIT_API_KEY not set");

// One router per Region that names one; the same key again.
const routers = new Map<string, Router>();
const routerFor = digitransitKey
  ? (region: Region) => {
      if (region.router?.kind !== "digitransit") return undefined;
      let router = routers.get(region.id);
      if (!router) {
        router = digitransitRouter({ url: region.router.url, apiKey: digitransitKey });
        routers.set(region.id, router);
      }
      return router;
    }
  : undefined;
if (!digitransitKey) console.log("Trips off: DIGITRANSIT_API_KEY not set");

// Parking near a Trip's destination: the Region's street parking, and car parks from its router.
const parkingFinders = new Map<string, ParkingFinder>();
const parkingFor = (region: Region): ParkingFinder | undefined => {
  let finder = parkingFinders.get(region.id);
  if (finder) return finder;
  const street = region.streetParking && helsinkiStreetParking(region.streetParking);
  const carParks = digitransitKey && region.router ? digitransitCarParks({ url: region.router.url, apiKey: digitransitKey }) : undefined;
  if (!street && !carParks) return undefined;
  finder = {
    async near(point) {
      const [streetNear, parksNear] = await Promise.all([
        street?.around(point).catch(() => undefined),
        carParks?.near(point).catch(() => []) ?? [],
      ]);
      if (!streetNear && !parksNear.length) return undefined;
      const sources = [
        ...(streetNear && region.streetParking ? [`${region.streetParking.publisher} (${region.streetParking.license})`] : []),
        ...(parksNear.length ? ["HSL / Digitransit"] : []),
      ];
      return { ...(streetNear ? { street: streetNear } : {}), carParks: parksNear, sources };
    },
  };
  parkingFinders.set(region.id, finder);
  return finder;
};

const stopIngest = startIngest(regions, events, { classification, ...(stopDirectory ? { stopDirectory } : {}) });

const app = createApp({
  db: {
    async ping() {
      await pool.query("select 1");
      return true;
    },
  },
  events,
  regions,
  ...(geocoderFor ? { geocoderFor } : {}),
  ...(routerFor ? { routerFor } : {}),
  parkingFor,
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Pulse API listening on http://localhost:${info.port}/v0`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopIngest();
    server.close();
    void pool.end().then(() => process.exit(0));
  });
}
