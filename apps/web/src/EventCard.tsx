import type { Event, Schema } from "@pulse/client";
import {
  Ban,
  BusFront,
  ChevronDown,
  CircleOff,
  Clock,
  ExternalLink,
  type LucideIcon,
  MapPin,
  Plane,
  Siren,
  Users,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { textIn, toneOf, type When, whenOf } from "./events.ts";
import { KindIcon, TONE_CLASSES, WHO_ICONS } from "./map/EventPin.tsx";

// The card that pops up from a pin, read top to bottom: WHO it affects (does this concern me?), what and where,
// when, WHY (the kind of work or Event) and HOW you'd notice it.

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
  const { t, i18n } = useTranslation();
  const [moreFor, setMoreFor] = useState<string>();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const Who = WHO_ICONS[event.mainlyAffected];
  const known = event.mainlyAffected !== "unknown";

  // Focus moves into the card, so a keyboard or screen reader follows it; Escape closes it from anywhere.
  useEffect(() => {
    heading.current?.focus();
  }, [event.id]);
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

      {(event.where.lineNames || event.where.stopNames || event.where.precision === "vague") && (
        <ul className="space-y-2 text-sm">
          {event.where.lineNames && (
            <Row icon={<BusFront aria-hidden className="size-4" />}>{t("lines", { count: event.where.lineNames.length, names: listOf(event.where.lineNames, i18n.language) })}</Row>
          )}
          {event.where.stopNames && (
            <Row icon={<MapPin aria-hidden className="size-4" />}>{t("stops", { count: event.where.stopNames.length, names: listOf(event.where.stopNames, i18n.language) })}</Row>
          )}
          {event.where.precision === "vague" && <li className="text-muted-foreground">{t("placedRoughly")}</li>}
        </ul>
      )}

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

      <Disclosure label={t("more")} open={moreFor === event.id} onToggle={(open) => setMoreFor(open ? event.id : undefined)}>
        <More event={event} languages={languages} timeZone={timeZone} />
      </Disclosure>
    </article>
  );
}

// A button that shows what's under it, and says whether it does.
function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onToggle(!open)}
        className="-mx-1 flex items-center gap-1 rounded px-1 py-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        {label}
      </button>
      {open && (
        <div id={id} className="space-y-3 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}

interface MoreProps {
  event: Event;
  languages: readonly string[];
  timeZone: string;
}

// Where it comes from: the Source's own text and the Sources.
function More({ event, languages, timeZone }: MoreProps) {
  const { t, i18n } = useTranslation();
  const updated = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone });
  return (
    <div className="max-h-[40dvh] space-y-3 overflow-y-auto text-sm">
      {event.originalText && (
        <section>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">{t("originalText")}</h4>
          <p className="whitespace-pre-line">{textIn(event.originalText, languages)}</p>
        </section>
      )}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">{t("sources")}</h4>
        <ul className="space-y-1">
          {event.sources.map((source) => (
            <li key={`${source.name}:${source.id}`}>
              <p>
                {source.name} · {source.license}
                {source.attribution ? ` · ${source.attribution}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">{t("sourceUpdated", { at: updated.format(new Date(source.updatedAt)) })}</p>
              {source.url && (
                <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                  {t("sourceAt", { name: source.name })}
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// "805, 95 and 96": in the app's language.
function listOf(names: string[], locale: string) {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </li>
  );
}

export function whenText(when: When, t: ReturnType<typeof useTranslation>["t"]): string {
  const main = t(when.key, when);
  return when.hours ? `${main} · ${t(when.hours.key, when.hours)}` : main;
}
