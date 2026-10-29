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
  ],
};
