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
  sheetTitle: "Around this point",
  sheetHint: "Tap something on the map to see what it is.",
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
