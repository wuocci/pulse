import helsinkiOutline from "./fi-capital-region-helsinki.json" with { type: "json" };
import { handKept } from "./fi-capital-region-hand-kept.ts";
import type { Region } from "./index.ts";

// Helsinki, its islands and shores: the City of Helsinki's districts (avoindata:Maavesi_suurpiirit, CC BY 4.0), joined,
// widened by 150 m so piers and the shoreline count, and simplified to about 80 m. Enough to tell a point in
// Helsinki from one in Espoo or Vantaa.
const helsinki: number[][][][] = helsinkiOutline;

const permitSystem = {
  adapter: "land-use-permits",
  url: "https://kartta.hel.fi/ws/geoserver/avoindata/wfs",
  publisher: "City of Helsinki",
  license: "CC BY 4.0",
  refreshMinutes: 180,
  covers: helsinki,
} as const;

export const fiCapitalRegion: Region = {
  id: "fi-capital-region",
  name: { en: "Helsinki capital region", fi: "Pääkaupunkiseutu", sv: "Huvudstadsregionen" },
  // Helsinki, Espoo, Vantaa and Kauniainen
  bbox: [24.4, 60.0, 25.3, 60.45],
  timeZone: "Europe/Helsinki",
  languages: ["fi", "sv", "en"],
  geocoder: { kind: "digitransit", url: "https://api.digitransit.fi/geocoding/v1" },
  router: { kind: "digitransit", url: "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1" },
  // Helsinki only: elsewhere in the Region it finds nothing, and car parks still come from Digitransit.
  streetParking: {
    kind: "helsinki-wfs",
    url: "https://kartta.hel.fi/ws/geoserver/avoindata/wfs",
    layer: "avoindata:Pysakointipaikat_alue",
    zonesLayer: "avoindata:Pysakoinnin_maksuvyohykkeet_alue",
    publisher: "City of Helsinki",
    license: "CC BY 4.0",
  },
  unavailable: [
    {
      id: "emergency-call-outs",
      name: { en: "Emergency call-outs", fi: "Hälytystehtävät", sv: "Larmuppdrag" },
      reason: {
        en: "No open feed publishes rescue call-outs since 1 Sep 2026",
        fi: "Mikään avoin syöte ei julkaise pelastustoimen hälytyksiä 1.9.2026 jälkeen",
        sv: "Inget öppet flöde publicerar räddningsverkets larm sedan 1.9.2026",
      },
    },
  ],
  defaultDailyHours: {
    works: { from: "07:00", to: "18:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    public_event: { from: "10:00", to: "22:00" },
  },
  sources: [
    {
      ...permitSystem,
      id: "hel-excavations",
      layer: "avoindata:Kaivuilmoitus_alue",
      permitType: "excavation",
      // Digs over the winter are dated to 14 May, when the permanent paving can be laid; the text has the work's own end.
      ruleEndDays: ["05-14"],
    },
    {
      ...permitSystem,
      id: "hel-traffic-arrangements",
      layer: "avoindata:Tilapainen_liikennejarjestely_alue",
      permitType: "traffic-arrangement",
    },
    { ...permitSystem, id: "hel-outdoor-events", layer: "avoindata:Tapahtumat_alue", permitType: "outdoor-event" },
    {
      adapter: "gtfs-rt",
      id: "hsl-service-alerts",
      url: "https://realtime.hsl.fi/realtime/service-alerts/v2/hsl",
      publisher: "HSL",
      license: "CC BY 4.0",
      refreshMinutes: 2,
      keepVanishedHours: 24,
      feedId: "HSL",
      directory: { kind: "digitransit", url: "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1" },
    },
    {
      adapter: "digitraffic",
      id: "fintraffic-road-messages",
      url: "https://tie.digitraffic.fi/api/traffic-message/v1/messages",
      // The attribution Digitraffic asks for: "Liikennetietojen lähde Fintraffic / digitraffic.fi, lisenssi CC 4.0 BY".
      publisher: "Fintraffic / digitraffic.fi",
      license: "CC BY 4.0",
      refreshMinutes: 5,
      // A message that's gone is over: resolved, shown for an hour.
      keepVanishedHours: 1,
    },
    {
      adapter: "cap",
      id: "fmi-warnings",
      url: "https://alerts.fmi.fi/cap/feed/atom_en-GB.xml",
      publisher: "Finnish Meteorological Institute",
      license: "CC BY 4.0",
      attribution: "Finnish Meteorological Institute, CC BY 4.0",
      refreshMinutes: 10,
      keepVanishedHours: 6,
      // Event codes from FMI's CAP profile (https://alerts.fmi.fi/cap/profile/v1.1.0/); codes not listed are for
      // everyone (rain, thunderstorm, wind). Sea warnings are for boats; UV, forest fire, heat and cold aren't in the
      // way of getting around.
      mainlyAffected: {
        trafficWeather: "drivers",
        pedestrianSafety: "pedestrians",
        seaWind: "nobody",
        seaWaveHeight: "nobody",
        seaIcing: "nobody",
        seaThunderstorm: "nobody",
        seaWaterHeight: "nobody",
        uvNote: "nobody",
        forestFireWeather: "nobody",
        hotWeather: "nobody",
        coldWeather: "nobody",
      },
    },
    {
      adapter: "hand-kept",
      id: "hand-kept",
      publisher: "City of Helsinki (kept by hand)",
      license: "CC BY 4.0",
      refreshMinutes: 60,
      entries: handKept,
    },
  ],
};
