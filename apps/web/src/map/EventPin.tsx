import type { Event, Schema } from "@pulse/client";
import {
  Activity,
  Ban,
  Bike,
  Bus,
  Car,
  Check,
  CircleHelp,
  CloudLightning,
  Construction,
  Footprints,
  type LucideIcon,
  PartyPopper,
  SquareParking,
  Users,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Pin, type Tone, textIn, toneOf } from "../events.ts";

// One Event on the map, saying three things and nothing more: who it affects (icon), how much it matters (colour)
// and, with a ring, that you'd notice it on site. Not known yet who: what kind of Event it is. A real button, so
// it's reachable without the map.

export const WHO_ICONS: Record<Schema<"MainlyAffected">, LucideIcon> = {
  drivers: Car,
  pedestrians: Footprints,
  cyclists: Bike,
  transit: Bus,
  parking: SquareParking,
  everyone: Users,
  nobody: Check,
  unknown: CircleHelp,
};

const ICONS: Record<Schema<"EventKind">, LucideIcon> = {
  works: Construction,
  closure: Ban,
  disruption: Bus,
  weather: CloudLightning,
  public_event: PartyPopper,
  anomaly: Activity,
};

export const TONE_CLASSES: Record<Tone, string> = {
  quiet: "border-neutral-400 bg-white text-neutral-700 dark:border-neutral-500 dark:bg-neutral-300 dark:text-neutral-800",
  consider: "border-amber-600 bg-amber-400 text-amber-950",
  major: "border-red-800 bg-red-600 text-white",
};

const TONE_LABEL = { quiet: "toneQuiet", consider: "toneConsider", major: "toneMajor" } as const;

// Noticeable on site (noise, a crowd, a blocked street…): a dark ring around the pin. Shared with the legend.
export const NOTICEABLE_RING = "outline-2 outline-offset-2 outline-neutral-900";

const TONE_RANK: Record<Tone, number> = { quiet: 0, consider: 1, major: 2 };

export function KindIcon({ kind, className = "size-5" }: { kind: Schema<"EventKind">; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon aria-hidden className={className} />;
}

// Who it affects or, not known yet, what kind of Event it is. A public event always says it's one: who it affects
// (everyone, pedestrians) would make a concert look like a crowd or a footpath. Shared by the pin and the list.
export function EventIcon({ event, className = "size-5" }: { event: Event; className?: string }) {
  const Who = WHO_ICONS[event.mainlyAffected];
  return event.mainlyAffected !== "unknown" && event.kind !== "public_event" ? (
    <Who aria-hidden className={className} />
  ) : (
    <KindIcon kind={event.kind} className={className} />
  );
}

export interface EventPinProps {
  pin: Pin;
  languages: readonly string[];
  selected: boolean;
  // Pointed at in the list, or glanced at on the map: marked, less than selected.
  highlighted?: boolean;
  onSelect: () => void;
  // The pin is pointed at with a mouse or reached with the keyboard, or no longer is: a glance at it opens. Not a
  // touch, which opens the card straight away.
  onHover?: (on: boolean) => void;
}

export function EventPin({ pin: { event }, languages, selected, highlighted = false, onSelect, onHover }: EventPinProps) {
  const { t } = useTranslation();
  const tone = toneOf(event);
  const resolved = event.status === "resolved";
  const label = [
    textIn(event.title, languages),
    t(`who_${event.mainlyAffected}`),
    t(TONE_LABEL[tone]),
    ...event.noticeable.map((n) => t(`how_${n}`).toLowerCase()),
    ...(resolved ? [t("ended")] : []),
  ].join(", ");

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      data-event-id={event.id}
      onClick={onSelect}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover?.(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onHover?.(false)}
      onFocus={(e) => focusVisible(e.currentTarget) && onHover?.(true)}
      onBlur={() => onHover?.(false)}
      // A tap on a pin isn't a long press on the map behind it.
      onPointerDown={(e) => e.stopPropagation()}
      className={[
        "relative grid size-9 place-items-center rounded-full border-2 shadow-md outline-none",
        "after:absolute after:-inset-1 after:content-['']", // 44 px to tap
        "focus-visible:ring-4 focus-visible:ring-ring/60 motion-safe:transition-transform",
        TONE_CLASSES[tone],
        event.noticeable.length ? NOTICEABLE_RING : "",
        resolved ? "opacity-50" : "",
        selected ? "z-10 scale-125 ring-4 ring-primary" : highlighted ? "z-10 scale-115 ring-4 ring-brand" : "",
      ].join(" ")}
    >
      <EventIcon event={event} />
    </button>
  );
}

// Focus from the keyboard, not from a tap or click.
function focusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

export interface PinGroupProps {
  pins: Pin[];
  languages: readonly string[];
  // Zooms the map in until they part; absent when they're at one spot, and a chooser opens instead.
  zoomIn: (() => void) | undefined;
  onSelect: (id: string) => void;
}

// Pins that overlap at this zoom, as one numbered bubble in the colour of the worst of them.
export function PinGroup({ pins, languages, zoomIn, onSelect }: PinGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const tone = pins.map(({ event }) => toneOf(event)).reduce<Tone>((worst, next) => (TONE_RANK[next] > TONE_RANK[worst] ? next : worst), "quiet");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    // A tap on the group isn't a long press on the map behind it.
    <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={t(zoomIn ? "groupZoom" : "groupChoose", { count: pins.length })}
        {...(zoomIn ? {} : { "aria-expanded": open, "aria-controls": listId })}
        onClick={() => (zoomIn ? zoomIn() : setOpen(!open))}
        className={`relative grid size-10 place-items-center rounded-full border-2 text-sm font-bold shadow-md outline-none after:absolute after:-inset-1 after:content-[''] focus-visible:ring-4 focus-visible:ring-ring/60 ${TONE_CLASSES[tone]}`}
      >
        {pins.length}
      </button>
      {open && (
        <ul id={listId} className="absolute top-12 left-1/2 z-20 w-64 -translate-x-1/2 space-y-1 rounded-xl bg-background p-2 text-foreground shadow-xl">
          {pins.map(({ key, event }) => (
            <li key={key}>
              <button
                type="button"
                data-event-id={event.id}
                onClick={() => {
                  setOpen(false);
                  onSelect(event.id);
                }}
                className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={`grid size-7 shrink-0 place-items-center rounded-full border-2 ${TONE_CLASSES[toneOf(event)]}`}>
                  <EventIcon event={event} className="size-4" />
                </span>
                <span className="line-clamp-2">{textIn(event.title, languages)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
