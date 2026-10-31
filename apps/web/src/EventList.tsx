import type { Event } from "@pulse/client";
import { useTranslation } from "react-i18next";
import { whenText } from "./EventCard.tsx";
import { type Pin, textIn, toneOf, whenOf } from "./events.ts";
import { EventIcon, TONE_CLASSES } from "./map/EventPin.tsx";

// Every Event on the map as a list, nearest first: the same choice as tapping its pin, without hunting for it.

export interface EventListProps {
  // Names the list; "Nearest first" when absent.
  label?: string;
  // Nearest first; an Event with many pins (stops) is listed once, at its nearest.
  pins: Pin[];
  selectedId: string | undefined;
  languages: readonly string[];
  timeZone: string;
  onSelect: (id: string) => void;
}

export function EventList({ label, pins, selectedId, languages, timeZone, onSelect }: EventListProps) {
  const { t, i18n } = useTranslation();
  const seen = new Set<string>();
  const nearest = pins.filter(({ event }) => !seen.has(event.id) && seen.add(event.id));
  const now = new Date();

  return (
    <ul aria-label={label ?? t("listTitle")} className="-mx-2 space-y-1">
      {nearest.map(({ event, distanceM }) => (
        <li key={event.id}>
          <button
            type="button"
            aria-current={event.id === selectedId ? true : undefined}
            onClick={() => onSelect(event.id)}
            className={`flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-current:bg-muted ${event.status === "resolved" ? "opacity-60" : ""}`}
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-full border-2 ${TONE_CLASSES[toneOf(event)]}`}>
              <EventIcon event={event} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-sm leading-snug font-medium">{textIn(event.title, languages)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {subtitle(event, timeZone, now, t)}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{distance(distanceM, i18n.language)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

function subtitle(event: Event, timeZone: string, now: Date, t: T): string {
  const when = whenText(whenOf(event, timeZone, now), t);
  return event.mainlyAffected === "unknown" ? when : `${t(`who_${event.mainlyAffected}`)} · ${when}`;
}

// "110 m" to the nearest ten metres, "2.2 km" from a kilometre.
function distance(m: number, language: string): string {
  return m < 1000
    ? new Intl.NumberFormat(language, { style: "unit", unit: "meter" }).format(Math.round(m / 10) * 10)
    : new Intl.NumberFormat(language, { style: "unit", unit: "kilometer", maximumFractionDigits: 1 }).format(m / 1000);
}
