import type { Event } from "@pulse/client";
import { useTranslation } from "react-i18next";
import { headingOf, plainTitle, toneOf, underOf, type When, whenOf } from "./events.ts";

// A glance at an Event from the map, and when-words shared with the cards (EventRows.tsx).

const SEVERITY_KEY = { info: "severityInfo", minor: "severityMinor", consider: "severityConsider", major: "severityMajor" } as const;

export function whenText(when: When, t: ReturnType<typeof useTranslation>["t"]): string {
  const main = t(when.key, when);
  return when.hours ? `${main} · ${t(when.hours.key, when.hours)}` : main;
}

export interface EventGlanceProps {
  event: Event;
  languages: readonly string[];
  timeZone: string;
  // Opens the full card.
  onOpen: () => void;
}

// A glance at an Event pointed at on the map: the card's top (what, where, how much it gets in the way, when) and
// nothing more. Clicking it opens the card.
export function EventGlance({ event, languages, timeZone, onOpen }: EventGlanceProps) {
  const { t } = useTranslation();
  const plain = plainTitle(event, languages);
  const under = underOf(plain);
  const who = event.mainlyAffected === "unknown" || event.mainlyAffected === "nobody" ? undefined : t(`who_${event.mainlyAffected}`);
  return (
    <button type="button" onClick={onOpen} className="glance" data-tone={toneOf(event)}>
      <span className="glance-title">{headingOf(plain, t)}</span>
      {under && <span className="glance-under">{under}</span>}
      <span className="glance-when">{[t(SEVERITY_KEY[event.severity]), whenText(whenOf(event, timeZone, new Date()), t), who].filter(Boolean).join(" · ")}</span>
    </button>
  );
}
