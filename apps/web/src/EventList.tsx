import type { Event } from "@pulse/client";
import { useEffect, useRef } from "react";
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
  // The Event pointed at (hovered or focused), so the map can show which shape is its; undefined when none.
  onHighlight?: (id: string | undefined) => void;
}

export function EventList({ label, pins, selectedId, languages, timeZone, onSelect, onHighlight }: EventListProps) {
  const { t, i18n } = useTranslation();
  // Chosen on the map: brought into view here.
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Not returned: newer browsers give a Promise back, and React would take it for a cleanup.
    void selected.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);
  const seen = new Set<string>();
  const nearest = pins.filter(({ event }) => !seen.has(event.id) && seen.add(event.id));
  const now = new Date();

  return (
    <ul aria-label={label ?? t("listTitle")} className="-mx-2 space-y-1">
      {nearest.map(({ event, distanceM, trip }) => (
        <li key={event.id}>
          <button
            type="button"
            ref={event.id === selectedId ? selected : undefined}
            aria-current={event.id === selectedId ? true : undefined}
            onClick={() => onSelect(event.id)}
            onPointerEnter={() => onHighlight?.(event.id)}
            onPointerLeave={() => onHighlight?.(undefined)}
            onFocus={() => onHighlight?.(event.id)}
            onBlur={() => onHighlight?.(undefined)}
            className={`flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-current:bg-muted ${event.status === "resolved" ? "opacity-60" : ""}`}
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-full border-2 ${TONE_CLASSES[toneOf(event)]}`}>
              <EventIcon event={event} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-sm leading-snug font-medium">{textIn(event.title, languages)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {subtitle(event, timeZone, now, t, trip?.crowd)}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {trip ? (trip.minutes ? t("atMinute", { count: trip.minutes }) : t("atStart")) : distance(distanceM, i18n.language)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

// On a Trip, a big event's crowd says when it starts or ends: that's when the crowd is there, not the event's day.
function subtitle(event: Event, timeZone: string, now: Date, t: T, crowd?: NonNullable<Pin["trip"]>["crowd"]): string {
  const when = crowd ? capitalised(crowdText(crowd, timeZone, t)) : whenText(whenOf(event, timeZone, now), t);
  return event.mainlyAffected === "unknown" ? when : `${t(`who_${event.mainlyAffected}`)} · ${when}`;
}

// "starts 19:00", "ends about 21:30".
export function crowdText({ at, time }: NonNullable<NonNullable<Pin["trip"]>["crowd"]>, timeZone: string, t: T): string {
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(time));
  return t(at === "start" ? "crowdStart" : "crowdEnd", { time: clock });
}

const capitalised = (text: string) => text.replace(/^./, (c) => c.toUpperCase());

// "110 m" to the nearest ten metres, "2.2 km" from a kilometre.
function distance(m: number, language: string): string {
  return m < 1000
    ? new Intl.NumberFormat(language, { style: "unit", unit: "meter" }).format(Math.round(m / 10) * 10)
    : new Intl.NumberFormat(language, { style: "unit", unit: "kilometer", maximumFractionDigits: 1 }).format(m / 1000);
}
