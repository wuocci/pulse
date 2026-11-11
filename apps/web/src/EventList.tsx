import type { Event } from "@pulse/client";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { whenText } from "./EventCard.tsx";
import { type Pin, plainTitle, type RowValue, startsOf, toneOf, untilOf, whenOf } from "./events.ts";
import { EventIcon, TONE_CLASSES } from "./map/EventPin.tsx";

// Events as a list: the same choice as tapping its pin, without hunting for it.

// A row: an Event and how far it is (none for a region-wide notice), or where a Trip meets it.
export type ListRow = Pick<Pin, "event" | "trip"> & { distanceM?: number };

export interface EventListProps {
  // Names the list; "Nearest first" when absent.
  label?: string;
  // In the order to list them; an Event with many pins (stops) is listed once, at its first.
  pins: ListRow[];
  selectedId: string | undefined;
  languages: readonly string[];
  timeZone: string;
  onSelect: (id: string) => void;
  // The Event pointed at (hovered or focused), so the map can show which shape is its; undefined when none.
  onHighlight?: (id: string | undefined) => void;
  // What each row leads with at its right: how far (the default), when it ends, or when it starts. A Trip's rows
  // say where on the way instead.
  lead?: "distance" | "until" | "starts";
}

export function EventList({ label, pins, selectedId, languages, timeZone, onSelect, onHighlight, lead = "distance" }: EventListProps) {
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
    <ul aria-label={label ?? t("listTitle")} className="space-y-2">
      {nearest.map(({ event, distanceM, trip }) => {
        const { title, address, workType, what } = plainTitle(event, languages);
        const far = distanceM !== undefined ? distance(distanceM, i18n.language) : undefined;
        const value: RowValue | undefined = trip ? undefined : lead === "until" ? untilOf(event, timeZone, now) : lead === "starts" ? startsOf(event, timeZone, now) : undefined;
        const details = trip
          ? [address, subtitle(event, timeZone, now, t, trip.crowd)]
          : [address, lead === "distance" ? whenText(whenOf(event, timeZone, now), t) : who(event, t), lead === "distance" ? undefined : far];
        return (
        <li key={event.id}>
          <button
            type="button"
            data-event-id={event.id}
            ref={event.id === selectedId ? selected : undefined}
            aria-current={event.id === selectedId ? true : undefined}
            onClick={() => onSelect(event.id)}
            onPointerEnter={() => onHighlight?.(event.id)}
            onPointerLeave={() => onHighlight?.(undefined)}
            onFocus={() => onHighlight?.(event.id)}
            onBlur={() => onHighlight?.(undefined)}
            className={`flex w-full items-center gap-3 rounded-3xl border bg-card p-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-current:border-brand ${event.status === "resolved" ? "opacity-60" : ""}`}
          >
            <span className={`grid size-11 shrink-0 place-items-center rounded-full border-2 ${TONE_CLASSES[toneOf(event)]}`}>
              <EventIcon event={event} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 leading-snug font-semibold">{workType ? t(`workTitle_${workType}`) : (what ?? title)}</span>
              <span className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                {details.filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end pr-1 text-right tabular-nums">
              {trip ? (
                <span className="text-sm font-medium text-muted-foreground">{trip.minutes ? t("atMinute", { count: trip.minutes }) : t("atStart")}</span>
              ) : value ? (
                <Lead value={value} caption={lead === "until" ? t("rowUntil") : t("rowStarts")} />
              ) : (
                far && <span className="font-semibold">{far}</span>
              )}
            </span>
          </button>
        </li>
        );
      })}
    </ul>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

// "until" over "1.4.2027", "starts" over "Tomorrow"; just "No end date" when there's none.
function Lead({ value, caption }: { value: RowValue; caption: string }) {
  const { t } = useTranslation();
  if (value.key === "rowNoEnd") return <span className="max-w-20 text-xs leading-tight text-muted-foreground">{t("rowNoEnd")}</span>;
  return (
    <>
      <span className="text-xs text-muted-foreground">{caption}</span>
      <span className="font-semibold">{value.key === "rowUntil" ? value.value : t(value.key, value)}</span>
    </>
  );
}

// Who it's mainly in the way of, when that's known.
const who = (event: Event, t: T) => (event.mainlyAffected === "unknown" ? undefined : t(`who_${event.mainlyAffected}`));

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
