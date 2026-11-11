import type { Event } from "@pulse/client";
import { ChevronDown, ExternalLink, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { plainTitle, textIn, type When, whenOf } from "./events.ts";

// The card that pops up from a pin, read top to bottom: what and where, how much it gets in the way, then a table of
// the facts (when, who it affects, what you'd see, which lines and stops), each row only when there's something to
// say. Where it comes from is at the bottom, with the Source's own words under More.

const SEVERITY = {
  info: { key: "severityInfo", pill: "bg-muted text-muted-foreground" },
  minor: { key: "severityMinor", pill: "bg-muted text-muted-foreground" },
  consider: { key: "severityConsider", pill: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" },
  major: { key: "severityMajor", pill: "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100" },
} as const;

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
  const { title, address, workType, what } = plainTitle(event, languages);
  const severity = SEVERITY[event.severity];
  const { lineNames = [], stopNames = [] } = event.where;
  // Who it affects only when that's known and someone is: "Not sure yet" says nothing in a fact table.
  const who = event.mainlyAffected === "unknown" || event.mainlyAffected === "nobody" ? undefined : t(`who_${event.mainlyAffected}`);
  const rows: [string, string][] = [
    [t("rowWhen"), whenText(whenOf(event, timeZone, new Date()), t)],
    ...(who ? [[t("rowAffects"), who] as [string, string]] : []),
    ...(event.noticeable.length ? [[t("rowNoticeable"), event.noticeable.map((n) => t(`how_${n}`)).join(" · ")] as [string, string]] : []),
    ...(lineNames.length ? [[t("rowLines", { count: lineNames.length }), listOf(lineNames, i18n.language)] as [string, string]] : []),
    ...(stopNames.length ? [[t("rowStops", { count: stopNames.length }), listOf(stopNames, i18n.language)] as [string, string]] : []),
    ...(event.where.precision === "vague" ? [[t("rowWhere"), t("placedRoughly")] as [string, string]] : []),
  ];

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
    <article aria-labelledby={titleId} className="w-[min(21rem,calc(100vw-2rem))] space-y-3 p-4 text-left text-foreground">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 ref={heading} id={titleId} tabIndex={-1} className="text-lg leading-tight font-semibold outline-none">
            {workType ? t(`workTitle_${workType}`) : (what ?? title)}
          </h3>
          {address && <p className="mt-0.5 text-sm text-muted-foreground">{address}</p>}
        </div>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-11 shrink-0" aria-label={t("close")} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>

      <p className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${severity.pill}`}>{t(severity.key)}</p>

      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t first:border-t-0">
              <th scope="row" className="w-24 py-1.5 pr-3 text-left align-top font-normal text-muted-foreground">
                {label}
              </th>
              <td className="py-1.5 align-top">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-start justify-between gap-x-2 border-t pt-2 text-xs text-muted-foreground">
        <Sources event={event} />
        <Disclosure label={t("more")} open={moreFor === event.id} onToggle={(open) => setMoreFor(open ? event.id : undefined)}>
          <More event={event} languages={languages} timeZone={timeZone} />
        </Disclosure>
      </div>
    </article>
  );
}

// "City of Helsinki ↗": each Source, linked when it has a page for this.
function Sources({ event }: { event: Event }) {
  const { t } = useTranslation();
  return (
    <ul className="min-w-0 space-y-0.5 py-1">
      {event.sources.map((source) => (
        <li key={`${source.name}:${source.id}`}>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("sourceAt", { name: source.name })}
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
            >
              {source.name}
              <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : (
            source.name
          )}
        </li>
      ))}
    </ul>
  );
}

// A button that shows what's under it, and says whether it does.
function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="contents">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onToggle(!open)}
        className="-mr-1 flex shrink-0 items-center gap-1 rounded px-1 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        {label}
      </button>
      {open && (
        <div id={id} className="basis-full space-y-3 pt-1">
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

// The Source's own words (its title and text) and terms, under More.
function More({ event, languages, timeZone }: MoreProps) {
  const { t } = useTranslation();
  const updated = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone });
  return (
    <div className="max-h-[40dvh] space-y-3 overflow-y-auto text-sm text-foreground">
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">{t("sourceTitle")}</h4>
        <p>{textIn(event.title, languages)}</p>
      </section>
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
  const { title, address, workType, what } = plainTitle(event, languages);
  const severity = SEVERITY[event.severity];
  const who = event.mainlyAffected === "unknown" || event.mainlyAffected === "nobody" ? undefined : t(`who_${event.mainlyAffected}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-[min(17rem,calc(100vw-2rem))] space-y-1.5 rounded-3xl p-3 text-left text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="line-clamp-2 leading-snug font-semibold">{workType ? t(`workTitle_${workType}`) : (what ?? title)}</span>
      {address && <span className="block truncate text-sm text-muted-foreground">{address}</span>}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${severity.pill}`}>{t(severity.key)}</span>
        <span>{[whenText(whenOf(event, timeZone, new Date()), t), who].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  );
}
