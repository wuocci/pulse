import type { Event } from "@pulse/client";
import { Link, useSearch } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import { useEvents } from "../api.ts";
import { whenText } from "../EventCard.tsx";
import { headingOf, plainTitle, sectionsOf, textIn, whenOf } from "../events.ts";
import type { LatLon } from "../platform.tsx";
import { meansOf } from "./means.ts";
import "./proto.css";

// THROWAWAY (design round 2026-11-25): the Signage style with a clear hierarchy and accordions, to check on the phone.
// Never merged. Three levels, each opened in place: a place → its Events → an Event's card → its Details.
// Real Events from the API around two sample places.

interface Place {
  name: string;
  point: LatLon;
}

// Sample places for the prototype; the real app keeps them on the phone.
const PLACES: Place[] = [
  { name: "Home", point: { lat: 60.1841, lon: 24.9497 } },
  { name: "Work", point: { lat: 60.1986, lon: 24.933 } },
];

const LANGUAGES = ["en", "fi"] as const;
const TIME_ZONE = "Europe/Helsinki";
// Rows a place shows when opened on Home; the rest are behind "All N".
const ROWS_ON_HOME = 4;

export function Proto() {
  const { place } = useSearch({ from: "/proto" });
  const picked = PLACES.find((p) => p.name === place);
  return <div className="proto">{picked ? <PlaceView place={picked} /> : <HomeView />}</div>;
}

// What's in your way near a place right now: consider and major, region-wide first, then nearest. Undefined while loading.
function useInYourWay({ point }: Place): Event[] | undefined {
  const { data } = useEvents(point);
  return data && sectionsOf(data, [], point).inYourWay;
}

// A header that opens and closes the panel under it, with the panel's height animated.
function Accordion({ open, onToggle, header, children, className }: { open: boolean; onToggle: () => void; header: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`proto-acc ${className ?? ""}`} data-open={open}>
      <button type="button" className="proto-acc-head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {header}
        <span className="proto-chevron" aria-hidden>
          ›
        </span>
      </button>
      <div id={id} className="proto-acc-panel" role="region" inert={!open}>
        <div className="proto-acc-inner">{children}</div>
      </div>
    </div>
  );
}

function HomeView() {
  const places = PLACES.map((place) => ({ place, events: useInYourWay(place) }));
  const loading = places.some((p) => p.events === undefined);
  const withSomething = places.filter((p) => p.events?.length);
  const [open, setOpen] = useState<string>();

  return (
    <main className="proto-main">
      <header className="proto-head">
        <span className="proto-mark">Pulse</span>
      </header>

      <nav className="proto-go" aria-label="Go">
        <Link to="/" search={{ trip: true }} className="proto-where">
          <span>Where to?</span>
          <span aria-hidden>→</span>
        </Link>
        <div className="proto-places">
          {PLACES.map((p) => (
            <Link key={p.name} to="/" search={{ trip: true, to: `${p.point.lat},${p.point.lon}`, toName: p.name }} className="proto-place">
              {p.name}
            </Link>
          ))}
          <button type="button" className="proto-place proto-place-add">
            + Add
          </button>
        </div>
      </nav>

      <section className="proto-status" aria-labelledby="status">
        <h2 id="status" className="proto-label">
          Near your places now
        </h2>
        {loading ? (
          <p className="proto-quiet">Checking…</p>
        ) : withSomething.length === 0 ? (
          <p className="proto-quiet">Nothing out of the ordinary</p>
        ) : (
          withSomething.slice(0, 3).map(({ place, events }) => (
            <PlaceLine key={place.name} place={place} events={events!} open={open === place.name} onToggle={() => setOpen(open === place.name ? undefined : place.name)} />
          ))
        )}
      </section>
    </main>
  );
}

// A place's line: the count and the place; opens to its Events.
function PlaceLine({ place, events, open, onToggle }: { place: Place; events: Event[]; open: boolean; onToggle: () => void }) {
  const major = events.filter((e) => e.severity === "major").length;
  return (
    <Accordion
      className="proto-line"
      open={open}
      onToggle={onToggle}
      header={
        <>
          <span className="proto-count" data-tone={major ? "major" : "consider"}>
            {events.length}
          </span>
          <span className="proto-line-body">
            <span className="proto-line-place">{place.name}</span>
            <span className="proto-line-text">{major ? `in your way · ${major} major` : "in your way"}</span>
          </span>
        </>
      }
    >
      <EventList events={events.slice(0, ROWS_ON_HOME)} />
      {events.length > ROWS_ON_HOME && (
        <Link to="/proto" search={{ place: place.name }} className="proto-all">
          All {events.length} near {place.name} ›
        </Link>
      )}
    </Accordion>
  );
}

function PlaceView({ place }: { place: Place }) {
  const events = useInYourWay(place);
  return (
    <main className="proto-main">
      <header className="proto-head">
        <Link to="/proto" className="proto-back">
          ← Back
        </Link>
      </header>
      <h1 className="proto-title">Near {place.name}</h1>
      <p className="proto-sub">{events ? `${events.length} in your way now` : "Checking…"}</p>
      <div className="proto-rows-top">{events && <EventList events={events} />}</div>
    </main>
  );
}

// Events as rows, one open at a time.
function EventList({ events }: { events: Event[] }) {
  const [open, setOpen] = useState<string>();
  return (
    <div className="proto-rows">
      {events.map((event) => (
        <EventRow key={event.id} event={event} open={open === event.id} onToggle={() => setOpen(open === event.id ? undefined : event.id)} />
      ))}
    </div>
  );
}

// What a row leads with: the plain title, or the street when the title says nothing specific.
function rowTitle(event: Event, t: (key: never) => string) {
  const plain = plainTitle(event, LANGUAGES);
  const heading = headingOf(plain, t as never);
  const generic = event.arrangementType === "other" || event.workType === "other";
  return generic && plain.address ? { title: plain.address, kind: heading, where: undefined } : { title: heading, kind: undefined, where: plain.address };
}

// A row: what (or where), then what it means for you. Opens to the card.
function EventRow({ event, open, onToggle }: { event: Event; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState(false);
  const { title, kind, where } = rowTitle(event, t as never);
  const source = event.sources[0];
  const text = event.originalText && textIn(event.originalText, ["fi", "en"]);
  const facts: [string, string][] = [
    ...(kind ? [["What", kind] as [string, string]] : []),
    ...(event.mainlyAffected !== "unknown" && event.mainlyAffected !== "nobody" ? [["Mostly", t(`who_${event.mainlyAffected}`)] as [string, string]] : []),
    ...(event.noticeable.length ? [["On site", event.noticeable.map((n) => t(`how_${n}`)).join(", ")] as [string, string]] : []),
    ...(event.where.lineNames?.length ? [["Lines", event.where.lineNames.join(", ")] as [string, string]] : []),
  ];

  return (
    <Accordion
      className="proto-row"
      open={open}
      onToggle={onToggle}
      header={
        <span className="proto-row-body" data-tone={event.severity}>
          <span className="proto-row-title">{title}</span>
          <span className="proto-row-sub">{meansOf(event)}</span>
        </span>
      }
    >
      <div className="proto-card" data-tone={event.severity}>
        <p className="proto-tone">{event.severity === "major" ? "Major disruption" : "Some disruption"}</p>
        <p className="proto-meta-strong">{whenText(whenOf(event, TIME_ZONE, new Date()), t)}</p>
        {where && <p className="proto-meta">{where}</p>}
        <Accordion className="proto-more" open={details} onToggle={() => setDetails(!details)} header={<span>Details</span>}>
          {facts.length > 0 && (
            <dl className="proto-facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {text && <p className="proto-text">{text}</p>}
          {source && (
            <p className="proto-source">
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.name} ↗
                </a>
              ) : (
                source.name
              )}
            </p>
          )}
        </Accordion>
      </div>
    </Accordion>
  );
}
