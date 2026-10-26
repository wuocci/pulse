import type { Region } from "./index.ts";

const permitSystem = {
  adapter: "land-use-permits",
  url: "https://kartta.hel.fi/ws/geoserver/avoindata/wfs",
  publisher: "City of Helsinki",
  license: "CC BY 4.0",
  refreshMinutes: 180,
} as const;

export const fiCapitalRegion: Region = {
  id: "fi-capital-region",
  name: { en: "Helsinki capital region", fi: "Pääkaupunkiseutu", sv: "Huvudstadsregionen" },
  // Helsinki, Espoo, Vantaa and Kauniainen
  bbox: [24.4, 60.0, 25.3, 60.45],
  timeZone: "Europe/Helsinki",
  languages: ["fi", "sv", "en"],
  sources: [
    { ...permitSystem, id: "hel-excavations", layer: "avoindata:Kaivuilmoitus_alue", permitType: "excavation" },
    {
      ...permitSystem,
      id: "hel-traffic-arrangements",
      layer: "avoindata:Tilapainen_liikennejarjestely_alue",
      permitType: "traffic-arrangement",
    },
    { ...permitSystem, id: "hel-outdoor-events", layer: "avoindata:Tapahtumat_alue", permitType: "outdoor-event" },
  ],
  conditionSources: [
    {
      id: "hsl-hfp",
      adapter: "hfp",
      url: "mqtts://mqtt.hsl.fi:8883",
      // Vehicle positions of ongoing journeys, every mode
      topic: "/hfp/v2/journey/ongoing/vp/#",
      publisher: "HSL",
      license: "CC BY 4.0",
    },
  ],
};
