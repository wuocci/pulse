import type { Region } from "./index.ts";

export const fiCapitalRegion: Region = {
  id: "fi-capital-region",
  name: { en: "Helsinki capital region", fi: "Pääkaupunkiseutu", sv: "Huvudstadsregionen" },
  // Helsinki, Espoo, Vantaa and Kauniainen
  bbox: [24.4, 60.0, 25.3, 60.45],
  timeZone: "Europe/Helsinki",
  languages: ["fi", "sv", "en"],
  sources: [
    {
      id: "hel-excavations",
      adapter: "land-use-permits",
      url: "https://kartta.hel.fi/ws/geoserver/avoindata/wfs",
      layer: "avoindata:Kaivuilmoitus_alue",
      kind: "works",
      publisher: "City of Helsinki",
      license: "CC BY 4.0",
      refreshMinutes: 180,
    },
  ],
};
