// Developer CLI for the Pulse API (/v0).
//
//   pnpm --filter @pulse/cli pulse health
//   pnpm --filter @pulse/cli pulse regions
//   pnpm --filter @pulse/cli pulse events --near "Sibeliuksenkatu 3" [--radius 1000] [--kind works] [--status active,resolved] [--region <id>] [--json]
//   pnpm --filter @pulse/cli pulse events --near 60.183,24.924

import { parseArgs } from "node:util";
import { EventSchema, HealthSchema, type Region, RegionSchema } from "@pulse/schema";
import { z } from "@hono/zod-openapi";

const apiUrl = process.env.PULSE_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/v0`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    near: { type: "string" },
    radius: { type: "string", default: "1000" },
    kind: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    status: { type: "string" },
    region: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const commands: Record<string, () => Promise<void>> = {
  async health() {
    const health = HealthSchema.parse(await get("/health"));
    print(health, () => console.log(`API ${health.status}, database ${health.database} (${apiUrl})`));
  },

  async regions() {
    const regions = await getRegions();
    print({ regions }, () =>
      console.table(
        regions.map((r) => ({
          id: r.id,
          name: r.name.en ?? Object.values(r.name)[0],
          timeZone: r.timeZone,
          languages: r.languages.join(", "),
        })),
      ),
    );
  },

  async events() {
    const params = new URLSearchParams();
    let place: string | undefined;
    if (values.near) {
      const point = await resolvePlace(values.near);
      place = point.label;
      params.set("near", `${point.lat},${point.lon},${values.radius}`);
    }
    for (const key of ["kind", "from", "to", "status"] as const) {
      const value = values[key];
      if (value) params.set(key, value);
    }

    const { events } = z.object({ events: z.array(EventSchema) }).parse(await get(`/events?${params}`));
    print({ events }, () => {
      if (place) console.log(`Within ${values.radius} m of ${place}:`);
      if (events.length === 0) return console.log("Nothing found.");
      console.table(
        events.map((e) => ({
          title: e.title.en ?? Object.values(e.title)[0],
          status: e.status,
          from: e.when.start.slice(0, 10),
          until: e.when.end?.slice(0, 10) ?? "-",
          source: e.sources.map((s) => s.name).join(", "),
        })),
      );
    });
  },
};

const command = commands[positionals[0] ?? ""];
if (!command) {
  console.error(`Usage: pulse <${Object.keys(commands).join("|")}> [options]`);
  process.exit(1);
}
try {
  await command();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function get(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(apiUrl + path);
  } catch {
    throw new Error(`Can't reach the Pulse API at ${apiUrl}. Is it running? (pnpm dev)`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Pulse API ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function print(data: unknown, pretty: () => void) {
  if (values.json) console.log(JSON.stringify(data, null, 2));
  else pretty();
}

async function getRegions(): Promise<Region[]> {
  return z.object({ regions: z.array(RegionSchema) }).parse(await get("/regions")).regions;
}

// --region picks one by id; without it, the API's only Region is used.
async function pickRegion(): Promise<Region> {
  const regions = await getRegions();
  const ids = regions.map((r) => r.id).join(", ");
  if (values.region) {
    const region = regions.find((r) => r.id === values.region);
    if (!region) throw new Error(`Unknown Region "${values.region}". Available: ${ids}`);
    return region;
  }
  if (regions.length !== 1) throw new Error(`Several Regions; pick one with --region (${ids}).`);
  return regions[0]!;
}

// "60.18,24.92" is used as is; anything else goes through Digitransit's geocoder.
async function resolvePlace(input: string): Promise<{ lat: number; lon: number; label: string }> {
  const coords = input.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) return { lat: Number(coords[1]), lon: Number(coords[2]), label: input.trim() };

  const key = process.env.DIGITRANSIT_API_KEY;
  if (!key) throw new Error("An address needs DIGITRANSIT_API_KEY in .env.local; or pass lat,lon.");
  // Bounded to the Region so a street name isn't matched in another town with the same street.
  const { bbox, languages } = await pickRegion();
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const params = new URLSearchParams({
    size: "1",
    lang: languages[0]!,
    "boundary.rect.min_lat": String(minLat),
    "boundary.rect.max_lat": String(maxLat),
    "boundary.rect.min_lon": String(minLon),
    "boundary.rect.max_lon": String(maxLon),
    text: input,
  });
  const url = `https://api.digitransit.fi/geocoding/v1/search?${params}`;
  const res = await fetch(url, { headers: { "digitransit-subscription-key": key } });
  const body = (await res.json()) as {
    features?: { geometry: { coordinates: [number, number] }; properties: { label: string } }[];
  };
  const hit = body.features?.[0];
  if (!res.ok || !hit) throw new Error(`Couldn't find "${input}".`);
  const [lon, lat] = hit.geometry.coordinates;
  return { lat, lon, label: hit.properties.label };
}
