import type { Event } from "@pulse/client";
import { useTranslation } from "react-i18next";
import { headingOf, plainTitle, underOf, type When, whenOf } from "./events.ts";

// A glance at an Event from the map, and when-words shared with the cards (EventRows.tsx).

const SEVERITY = {
  info: { key: "severityInfo", pill: "bg-muted text-muted-foreground" },
  minor: { key: "severityMinor", pill: "bg-muted text-muted-foreground" },
  consider: { key: "severityConsider", pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" },
  major: { key: "severityMajor", pill: "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100" },
} as const;

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
  const severity = SEVERITY[event.severity];
  const who = event.mainlyAffected === "unknown" || event.mainlyAffected === "nobody" ? undefined : t(`who_${event.mainlyAffected}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-[min(17rem,calc(100vw-2rem))] space-y-1.5 rounded-3xl p-3 text-left text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="line-clamp-2 leading-snug font-semibold">{headingOf(plain, t)}</span>
      {under && <span className="block truncate text-sm text-muted-foreground">{under}</span>}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${severity.pill}`}>{t(severity.key)}</span>
        <span>{[whenText(whenOf(event, timeZone, new Date()), t), who].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  );
}
