import type { Event } from "@pulse/client";
import { type ComponentProps, type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import { useRegions } from "./api.ts";
import { whenText } from "./EventCard.tsx";
import { headingOf, plainTitle, readingLanguages, streetOf, textIn, whenOf } from "./events.ts";
import { type Means, meansOf } from "./means.ts";
import "./signage.css";

// The Signage parts Home and Around share (design round 2026-11-25): an accordion, and an Event's row that opens to
// its card, which opens to its Details. What changes plans is in signal colours; the rest is quiet, there for anyone
// who looks, never pushed (an Event's Decision).

type T = ReturnType<typeof useTranslation>["t"];

type HeadProps = Omit<ComponentProps<"button">, "onClick" | "type" | "children" | "ref"> & { [data: `data-${string}`]: string | undefined };

// A header that opens and closes the panel under it.
export function Accordion({
  open,
  onToggle,
  header,
  children,
  className,
  headProps,
  headRef,
}: {
  open: boolean;
  onToggle: () => void;
  header: ReactNode;
  children: ReactNode;
  className: string;
  headProps?: HeadProps;
  headRef?: Ref<HTMLButtonElement>;
}) {
  const id = useId();
  return (
    <div className={`acc ${className}`} data-open={open}>
      <button ref={headRef} type="button" className="acc-head" aria-expanded={open} aria-controls={id} onClick={onToggle} {...headProps}>
        {header}
        <span className="acc-chevron" aria-hidden>
          ›
        </span>
      </button>
      <div id={id} className="acc-panel" role="region" inert={!open} aria-hidden={!open}>
        <div className="acc-inner">{children}</div>
      </div>
    </div>
  );
}

// How loud a row is: signal colours only for what changes plans.
export type RowTone = "major" | "consider" | "quiet";
export function rowToneOf(event: Event): RowTone {
  if (event.decision !== "change_plans") return "quiet";
  return event.severity === "major" ? "major" : "consider";
}

// What a row leads with: where, when the Event has a street, since where matters more than what kind of work it is
// ("Castreninkatu 1", not "Cable dig"), and a permit's first sentence is in Finnish. What it is opens the card. A
// transit alert or an event names its own place, so it keeps its title.
function rowTitle(event: Event, t: T, languages: readonly string[]) {
  const plain = plainTitle(event, languages);
  const kind = plain.label ? t(plain.label) : plain.what ? undefined : plain.title;
  return plain.address ? { title: streetOf(plain.address), kind } : { title: headingOf(plain, t), kind: undefined };
}

function meansText({ key, lines, noisy }: Means, t: T): string {
  const means = t(key, { lines });
  return noisy ? t("meansNoisy", { means }) : means;
}

const listOf = (names: string[], locale: string) => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);

export interface EventRowProps {
  event: Event;
  open: boolean;
  onToggle: () => void;
  // At the row's right: how far, until when, or when it starts.
  aside?: ReactNode;
  // The row pointed at (hovered or focused), so a map can show which shape is its; undefined when none.
  onHighlight?: (id: string | undefined) => void;
}

// A row: where (or what), then what it means for you. Opens to the card: how big, what it is, when, then Details.
export function EventRow({ event, open, onToggle, aside, onHighlight }: EventRowProps) {
  const { t, i18n } = useTranslation();
  const regions = useRegions();
  const region = regions.data?.[0];
  const languages = readingLanguages(i18n.language, region?.languages);
  const timeZone = region?.timeZone ?? "Europe/Helsinki";
  const [details, setDetails] = useState(false);
  const head = useRef<HTMLButtonElement>(null);
  // Opened from elsewhere (a pin on the map, a link): brought into view, with focus, so the keyboard follows.
  useEffect(() => {
    if (!open || document.activeElement === head.current) return;
    head.current?.focus({ preventScroll: true });
    // Not returned: newer browsers give a Promise back, and React would take it for a cleanup.
    void head.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  const { title, kind } = rowTitle(event, t, languages);
  const tone = rowToneOf(event);
  const text = event.originalText && textIn(event.originalText, languages);
  const { lineNames = [], stopNames = [] } = event.where;
  const facts: [string, string][] = [
    ...(event.mainlyAffected !== "unknown" && event.mainlyAffected !== "nobody" ? [[t("factMostly"), t(`who_${event.mainlyAffected}`)] as [string, string]] : []),
    ...(event.noticeable.length ? [[t("factOnSite"), event.noticeable.map((n) => t(`how_${n}`)).join(", ")] as [string, string]] : []),
    ...(lineNames.length ? [[t("factLines"), lineNames.join(", ")] as [string, string]] : []),
    ...(stopNames.length ? [[t("rowStops", { count: stopNames.length }), listOf(stopNames, i18n.language)] as [string, string]] : []),
    ...(event.where.precision === "vague" ? [[t("rowWhere"), t("placedRoughly")] as [string, string]] : []),
  ];
  const updated = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone });
  const toneLabel = tone === "quiet" ? (event.decision === "no_effect" ? "decisionNoEffect" : "decisionWorthKnowing") : tone === "major" ? "severityMajor" : "severityConsider";

  return (
    <Accordion
      className="sg-row"
      open={open}
      onToggle={onToggle}
      headRef={head}
      headProps={{
        "data-event-id": event.id,
        onPointerEnter: () => onHighlight?.(event.id),
        onPointerLeave: () => onHighlight?.(undefined),
        onFocus: () => onHighlight?.(event.id),
        onBlur: () => onHighlight?.(undefined),
      }}
      header={
        <>
          <span className="sg-row-body" data-tone={tone}>
            <span className="sg-row-title">{title}</span>
            <span className="sg-row-sub">{meansText(meansOf(event), t)}</span>
          </span>
          {aside && <span className="sg-row-aside">{aside}</span>}
        </>
      }
    >
      <article className="sg-card" data-tone={tone} aria-label={title}>
        <p className="sg-tone">{t(toneLabel)}</p>
        {kind && <p className="sg-kind">{kind}</p>}
        <p className="sg-when">{whenText(whenOf(event, timeZone, new Date()), t)}</p>
        <Accordion className="sg-more" open={details} onToggle={() => setDetails(!details)} header={<span>{t("homeDetails")}</span>}>
          {facts.length > 0 && (
            <dl className="sg-facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {text && <p className="sg-text">{text}</p>}
          <ul className="sg-source">
            {event.sources.map((source) => (
              <li key={`${source.name}:${source.id}`}>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.name} ↗
                  </a>
                ) : (
                  <b>{source.name}</b>
                )}{" "}
                · {source.license}
                {source.attribution ? ` · ${source.attribution}` : ""}
                <span className="sg-updated">{t("sourceUpdated", { at: updated.format(new Date(source.updatedAt)) })}</span>
              </li>
            ))}
          </ul>
        </Accordion>
      </article>
    </Accordion>
  );
}
