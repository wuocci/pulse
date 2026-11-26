import type { Event } from "@pulse/client";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LocateFixed } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddressSearch } from "./AddressSearch.tsx";
import { eventsQuery, useRegions } from "./api.ts";
import { Accordion, EventRow } from "./EventRows.tsx";
import { inMyArea, nearestFirst } from "./events.ts";
import { MAX_PLACES, type SavedPlace, USUAL_NAMES, usePlaces } from "./places.ts";
import { type LatLon, usePlatform } from "./platform.tsx";
import { centreOf, formatAt } from "./point.ts";

// Your places (design round 2026-11-25, Home folded into Around 2026-11-26): one-tap destinations under Where to?,
// saved from anywhere you meet a place (Set Home, the place you look around, a Trip's To, the map),
// and a line per place where something changes plans right now, at the top of the list; nothing at all when nothing
// does ("tell things without telling them"). Each opens in place: a place's Events, an Event's card, its Details.
// Only what changes plans reaches these lines (an Event's Decision); the rest is in the sections under them.

// Rows a place shows when opened; the rest are a tap away, around that place.
const ROWS = 4;
// Lines at most: more places than that is a list, not a glance.
const LINES = 3;

// The places as one-tap destinations. Home and Work not set yet wait as "Set Home" and "Set Work"; a place is changed
// by holding it (or a right click), and in Settings.
export function PlacesRow() {
  const { t } = useTranslation();
  const { places } = usePlaces();
  const [panel, setPanel] = useState<{ adding: string } | { editing: string }>();
  const missing = USUAL_NAMES.filter((n) => !places?.some((p) => p.name === n));
  const room = MAX_PLACES - (places?.length ?? 0);
  return (
    <div className="home-go">
      <div className="home-places" role="group" aria-label={t("yourPlaces")}>
        {places?.map((p) => (
          <PlaceLink key={p.name} place={p} onHold={() => setPanel({ editing: p.name })} />
        ))}
        {missing.slice(0, room).map((name) => (
          <button key={name} type="button" className="home-place home-place-quiet" onClick={() => setPanel({ adding: name })} aria-expanded={!!panel && "adding" in panel && panel.adding === name}>
            {t("placesSet", { name })}
          </button>
        ))}
        {!missing.length && room > 0 && (
          <button type="button" className="home-place home-place-quiet" onClick={() => setPanel({ adding: "" })} aria-expanded={!!panel && "adding" in panel && panel.adding === ""}>
            {t("homeAddPlace")}
          </button>
        )}
      </div>
      {panel && "adding" in panel && <PlaceForm key={`add-${panel.adding}`} name={panel.adding} onDone={() => setPanel(undefined)} />}
      {panel && "editing" in panel && <PlaceForm key={`edit-${panel.editing}`} editing={panel.editing} onDone={() => setPanel(undefined)} />}
      {places?.length === 0 && !panel && <p className="home-prompt">{t("homeAddPrompt")}</p>}
    </div>
  );
}

// How long a place is held before it opens to be changed.
const HOLD_MS = 500;

// A place: a tap goes there; a hold (or a right click) changes it.
function PlaceLink({ place, onHold }: { place: SavedPlace; onHold: () => void }) {
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hold = () => {
    held.current = true;
    onHold();
  };
  return (
    <Link
      to="/"
      search={(prev) => ({ ...prev, trip: true, to: formatAt(place), toName: place.name, mode: undefined, route: undefined })}
      className="home-place"
      onPointerDown={() => {
        held.current = false;
        timer.current = setTimeout(hold, HOLD_MS);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onContextMenu={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        if (!held.current) hold();
      }}
      onClick={(e) => {
        if (held.current) e.preventDefault();
        held.current = false;
      }}
    >
      {place.name}
    </Link>
  );
}

// Your places, each opening to be changed: Settings' list.
export function PlacesList() {
  const { t } = useTranslation();
  const { places } = usePlaces();
  const [editing, setEditing] = useState<string>();
  if (!places?.length) return <p className="settings-hint">{t("placesNone")}</p>;
  return (
    <ul className="places-list">
      {places.map((p) => (
        <li key={p.name}>
          <button type="button" className="places-list-item" aria-expanded={editing === p.name} onClick={() => setEditing(editing === p.name ? undefined : p.name)}>
            {p.name}
            <span aria-hidden>›</span>
          </button>
          {editing === p.name && <PlaceForm editing={p.name} onDone={() => setEditing(undefined)} />}
        </li>
      ))}
    </ul>
  );
}

interface PlaceFormProps {
  // Changing a saved place, by its name.
  editing?: string;
  // Saving a new one: the name offered, and where it is when that's known (the point, a Trip's To, the map).
  name?: string;
  at?: LatLon;
  onDone: () => void;
}

// Saving or changing a place: its name (Home and Work a tap away), and where it is when that isn't known yet: your
// location, or an address. A saved place renames or goes.
export function PlaceForm({ editing, name: offered = "", at, onDone }: PlaceFormProps) {
  const { t, i18n } = useTranslation();
  const { places, add, remove, rename } = usePlaces();
  const { location } = usePlatform();
  const regions = useRegions();
  const near = at ?? places?.[0] ?? (regions.data?.[0] ? centreOf(regions.data[0]) : undefined);
  const [name, setName] = useState(editing ?? offered);
  // Where the place is, and what to call that: your location or the address picked.
  const [picked, setPicked] = useState<{ at: LatLon; label?: string } | undefined>(at && { at });
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);
  const nameId = useId();
  const trimmed = name.trim();
  const taken = trimmed !== editing && places?.some((p) => p.name === trimmed);
  const quick = [...USUAL_NAMES, ...(offered && !USUAL_NAMES.includes(offered as never) ? [offered] : [])].filter((n) => n !== trimmed);

  const takeHere = async () => {
    setFailed(false);
    setLocating(true);
    try {
      setPicked({ at: await location.current(), label: t("currentLocation") });
    } catch {
      setFailed(true);
    } finally {
      setLocating(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    if (editing) {
      if (trimmed !== editing) rename(editing, trimmed);
    } else if (picked) add({ name: trimmed, lat: picked.at.lat, lon: picked.at.lon });
    else return;
    onDone();
  };

  return (
    <form className="home-add" onSubmit={submit} aria-label={editing ? t("editPlaceTitle", { name: editing }) : t("addPlaceTitle")}>
      <label htmlFor={nameId} className="home-add-label">
        {t("placeName")}
      </label>
      <input id={nameId} className="home-add-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required autoFocus={!!editing || !!at} />
      {(editing || at) && quick.length > 0 && (
        <div className="home-add-quick" role="group" aria-label={t("placeNameQuick")}>
          {quick.map((n) => (
            <button key={n} type="button" className="home-add-chip" onClick={() => setName(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
      {taken && <p className="home-add-note">{t("placeReplaces", { name: trimmed })}</p>}
      {!editing && !at && (
        <>
          <span className="home-add-label">{t("placeAddress")}</span>
          <button type="button" className="around-here" disabled={locating} onClick={() => void takeHere()}>
            <LocateFixed aria-hidden className="size-5" />
            {locating ? t("locating") : t("useMyLocation")}
          </button>
          {failed && <p role="alert" className="home-add-note">{t("locationUnavailable")}</p>}
          <AddressSearch point={near} lang={i18n.language} label={t("placeAddress")} onPick={(p) => setPicked({ at: p, label: p.label })} autoFocus={!!offered} />
          {picked?.label && !locating && (
            <p role="status" className="home-add-note">
              {t("placePicked", { place: picked.label })}
            </p>
          )}
        </>
      )}
      <div className="home-add-actions">
        <button type="submit" className="home-add-save" disabled={!trimmed || (!editing && !picked)}>
          {t("savePlace")}
        </button>
        {editing && (
          <button
            type="button"
            className="home-add-remove"
            onClick={() => {
              remove(editing);
              onDone();
            }}
          >
            {t("placeRemove", { name: editing })}
          </button>
        )}
        <button type="button" className="home-add-cancel" onClick={onDone}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

// The lines for your places, only where something changes plans.
export function YourPlaces() {
  const { places } = usePlaces();
  const [open, setOpen] = useState<string>();
  return <PlaceLines places={(places ?? []).slice(0, LINES)} open={open} onToggle={(name) => setOpen(open === name ? undefined : name)} />;
}

// What changes plans near a place right now, nearest first.
function changesPlans(data: Event[] | undefined, place: LatLon): Event[] | undefined {
  if (!data) return undefined;
  const changing = data.filter((e) => e.decision === "change_plans" && e.mainlyAffected !== "nobody" && inMyArea(e));
  const order = new Map<string, number>();
  nearestFirst(changing, place).forEach((pin, i) => order.has(pin.event.id) || order.set(pin.event.id, i));
  return changing.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
}

// The lines, under a label, only when there's something; silence says nothing changes your plans.
function PlaceLines({ places, open, onToggle }: { places: SavedPlace[]; open: string | undefined; onToggle: (name: string) => void }) {
  const { t } = useTranslation();
  const results = useQueries({ queries: places.map((place) => eventsQuery(place)) });
  const found = places.map((place, i) => ({ place, events: changesPlans(results[i]?.data, place) }));
  const lines = found.filter((f) => f.events?.length);
  if (!lines.length) return null;
  return (
    <section className="home-status" aria-labelledby="home-status">
      <h2 id="home-status" className="home-label">
        {t("homeNearPlaces")}
      </h2>
      {lines.map(({ place, events }) => (
        <PlaceLine key={place.name} place={place} events={events!} open={open === place.name} onToggle={() => onToggle(place.name)} />
      ))}
    </section>
  );
}

function PlaceLine({ place, events, open, onToggle }: { place: SavedPlace; events: Event[]; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const major = events.filter((e) => e.severity === "major").length;
  const line = t("homePlaceLine", { count: events.length });
  const [shown, setShown] = useState<string>();
  return (
    <Accordion
      className="home-line"
      open={open}
      onToggle={onToggle}
      header={
        <>
          <span className="home-count" data-tone={major ? "major" : "consider"}>
            {events.length}
          </span>
          <span className="home-line-body">
            <span className="home-line-place">{place.name}</span>
            <span className="home-line-text">{major ? t("homePlaceLineMajor", { line, count: major }) : line}</span>
          </span>
        </>
      }
    >
      <div className="home-rows">
        {events.slice(0, ROWS).map((event) => (
          <EventRow key={event.id} event={event} open={shown === event.id} onToggle={() => setShown(shown === event.id ? undefined : event.id)} />
        ))}
      </div>
      {events.length > ROWS && (
        <Link to="/" search={(prev) => ({ ...prev, at: formatAt(place), event: undefined })} className="home-all">
          {t("homeAllNear", { count: events.length, place: place.name })} ›
        </Link>
      )}
    </Accordion>
  );
}

