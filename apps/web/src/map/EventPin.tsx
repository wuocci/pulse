import type { Schema } from "@pulse/client";
import { Activity, Ban, Bus, CloudLightning, Construction, type LucideIcon, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type Pin, type Tone, textIn, toneOf } from "../events.ts";

// One Event on the map, saying two things and nothing more: what it is (icon) and how much it matters (colour).
// A real button, so it's reachable without the map.

const ICONS: Record<Schema<"EventKind">, LucideIcon> = {
  works: Construction,
  closure: Ban,
  disruption: Bus,
  weather: CloudLightning,
  public_event: Ticket,
  anomaly: Activity,
};

export const TONE_CLASSES: Record<Tone, string> = {
  quiet: "border-neutral-400 bg-white text-neutral-700",
  consider: "border-amber-600 bg-amber-400 text-amber-950",
  major: "border-red-800 bg-red-600 text-white",
};

const TONE_LABEL = { quiet: "toneQuiet", consider: "toneConsider", major: "toneMajor" } as const;

export function KindIcon({ kind, className = "size-5" }: { kind: Schema<"EventKind">; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon aria-hidden className={className} />;
}

export interface EventPinProps {
  pin: Pin;
  languages: readonly string[];
  selected: boolean;
  onSelect: () => void;
}

export function EventPin({ pin: { event }, languages, selected, onSelect }: EventPinProps) {
  const { t } = useTranslation();
  const tone = toneOf(event);
  const resolved = event.status === "resolved";
  const label = [textIn(event.title, languages), t(TONE_LABEL[tone]), ...(resolved ? [t("ended")] : [])].join(", ");

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      data-event-id={event.id}
      onClick={onSelect}
      // A tap on a pin isn't a long press on the map behind it.
      onPointerDown={(e) => e.stopPropagation()}
      className={[
        "relative grid size-9 place-items-center rounded-full border-2 shadow-md outline-none",
        "after:absolute after:-inset-1 after:content-['']", // 44 px to tap
        "focus-visible:ring-4 focus-visible:ring-ring/60 motion-safe:transition-transform",
        TONE_CLASSES[tone],
        resolved ? "opacity-50" : "",
        selected ? "z-10 scale-125 ring-4 ring-primary" : "",
      ].join(" ")}
    >
      <KindIcon kind={event.kind} />
    </button>
  );
}
