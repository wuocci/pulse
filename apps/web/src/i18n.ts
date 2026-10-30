import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// All UI text. English only for now; Finnish is a translation job, not a code change.
export const en = {
  appName: "Pulse",
  map: "Map. Long-press, or right-click, to choose a place.",
  goToMyLocation: "Go to my location",
  followMyLocation: "Follow my location",
  followingYourLocation: "Following your location",
  locating: "Finding you…",
  locationDenied: "Location is off. Allow it for this site, or long-press the map to choose a place.",
  locationUnavailable: "Couldn't find your location. Try again, or long-press the map to choose a place.",
  regionsFailed: "Can't reach Pulse right now.",
  sheetHint: "Tap something on the map to see what it is.",
  time: "When",
  timeNow: "Now",
  time14d: "14 days",
  statusClearNow: "All clear right now",
  statusClearSoon: "All clear for the next 2 weeks",
  statusNow_one: "1 thing going on near you",
  statusNow_other: "{{count}} things going on near you",
  statusSoon_one: "1 thing around here in the next 2 weeks",
  statusSoon_other: "{{count}} things around here in the next 2 weeks",
  statusMajor: "{{status}} · {{major}} major",
  statusError: "Can't reach Pulse right now",
  toneQuiet: "minor",
  toneConsider: "worth considering",
  toneMajor: "major",
  ended: "ended",
  close: "Close",
  whenUntil: "Until {{end}}",
  whenOngoing: "Ongoing",
  whenFrom: "From {{start}}",
  whenFromTo: "{{start}} – {{end}}",
  whenEnded: "Ended {{end}}",
  hoursDaily: "daily {{from}}–{{to}}",
  hoursWeekdays: "weekdays {{from}}–{{to}}",
  hoursDays: "{{days}} {{from}}–{{to}}",
  severityInfo: "For information",
  severityMinor: "Minor",
  severityConsider: "Worth considering",
  severityMajor: "Major",
  sheetTitle: "Map controls",
  who_drivers: "Drivers",
  who_pedestrians: "Pedestrians",
  who_cyclists: "Cyclists",
  who_transit: "Public transport",
  who_parking: "Parking",
  who_everyone: "Everyone",
  who_nobody: "Doesn't get in anyone's way",
  who_unknown: "Not sure yet who this affects",
  work_water_sewer: "Water and sewer works",
  work_district_heating: "District heating works",
  work_electricity_telecom: "Electricity or telecom works",
  work_paving: "Paving",
  work_street_construction: "Street construction",
  work_building_site: "Building site",
  work_other: "Other works",
  kind_works: "Works",
  kind_closure: "Closure",
  kind_disruption: "Transit disruption",
  kind_weather: "Weather",
  kind_public_event: "Public event",
  kind_anomaly: "Unusual delays",
  howNoticeable: "How you'd notice it",
  how_noise: "Noisy",
  how_crowd: "Crowds",
  how_sirens: "Sirens",
  how_blocked: "Blocks the way",
  how_aircraft: "Low-flying aircraft",
  how_outage: "Out of service",
  expand: "Expand",
  collapse: "Collapse",
} as const;

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en } },
  // React escapes already.
  interpolation: { escapeValue: false },
});

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

export { i18n };
