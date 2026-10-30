import type { Event, Schema } from "@pulse/client";
import {
  Ban,
  Bike,
  Bus,
  Car,
  Check,
  CircleHelp,
  CircleOff,
  Clock,
  Footprints,
  type LucideIcon,
  Plane,
  Siren,
  SquareParking,
  Users,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { textIn, toneOf, type When, whenOf } from "./events.ts";
import { KindIcon, TONE_CLASSES } from "./map/EventPin.tsx";

// The card that pops up from a pin, read top to bottom: WHO it affects (does this concern me?), what and where,
// when, WHY (the kind of work or Event) and HOW you'd notice it.

const WHO: Record<Schema<"MainlyAffected">, LucideIcon> = {
  drivers: Car,
  pedestrians: Footprints,
  cyclists: Bike,
  transit: Bus,
  parking: SquareParking,
  everyone: Users,
  nobody: Check,
  unknown: CircleHelp,
};

const HOW: Record<Schema<"Noticeable">, LucideIcon> = {
  noise: Volume2,
  crowd: Users,
  sirens: Siren,
  blocked: Ban,
  aircraft: Plane,
  outage: CircleOff,
};

const SEVERITY = { info: "severityInfo", minor: "severityMinor", consider: "severityConsider", major: "severityMajor" } as const;

export interface EventCardProps {
  event: Event;
  languages: readonly string[];
  timeZone: string;
  onClose: () => void;
}

export function EventCard({ event, languages, timeZone, onClose }: EventCardProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const Who = WHO[event.mainlyAffected];
  const known = event.mainlyAffected !== "unknown";

  // Focus moves into the card, so a keyboard or screen reader follows it; Escape closes it from anywhere.
  useEffect(() => heading.current?.focus(), [event.id]);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <article aria-labelledby={titleId} className="w-[min(20rem,calc(100vw-3rem))] space-y-3 p-4 text-left text-foreground">
      <div className="flex items-start gap-3">
        <span className={`grid size-12 shrink-0 place-items-center rounded-full border-2 ${known ? TONE_CLASSES[toneOf(event)] : TONE_CLASSES.quiet}`}>
          <Who aria-hidden className="size-6" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className={`text-lg leading-tight font-semibold ${known ? "" : "text-muted-foreground"}`}>
            {t(`who_${event.mainlyAffected}`)}
          </p>
          <p className="text-sm text-muted-foreground">{t(SEVERITY[event.severity])}</p>
        </div>
        <Button variant="ghost" size="icon" className="-mt-2 -mr-2 size-11 shrink-0" aria-label={t("close")} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>

      <h3 ref={heading} id={titleId} tabIndex={-1} className="leading-snug font-medium outline-none">
        {textIn(event.title, languages)}
      </h3>

      <ul className="space-y-2 text-sm">
        <Row icon={<Clock aria-hidden className="size-4" />}>{whenText(whenOf(event, timeZone, new Date()), t)}</Row>
        <Row icon={event.workType ? <Wrench aria-hidden className="size-4" /> : <KindIcon kind={event.kind} className="size-4" />}>
          {event.workType ? t(`work_${event.workType}`) : t(`kind_${event.kind}`)}
        </Row>
      </ul>

      {event.noticeable.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("howNoticeable")}>
          {event.noticeable.map((n) => {
            const How = HOW[n];
            return (
              <li key={n} className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm">
                <How aria-hidden className="size-4" />
                {t(`how_${n}`)}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </li>
  );
}

function whenText(when: When, t: ReturnType<typeof useTranslation>["t"]): string {
  const main = t(when.key, when);
  return when.hours ? `${main} · ${t(when.hours.key, when.hours)}` : main;
}
