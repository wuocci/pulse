import type { Event, GeocodeResult } from "@pulse/client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddressSearch } from "./AddressSearch.tsx";
import { eventsQuery, useRegions } from "./api.ts";
import { Accordion, EventRow } from "./EventRows.tsx";
import { inMyArea, nearestFirst } from "./events.ts";
import { MAX_PLACES, type SavedPlace, usePlaces } from "./places.ts";
import { type LatLon, usePlatform } from "./platform.tsx";
import { centreOf, formatAt } from "./point.ts";

// Home (design round 2026-11-25): "tell things without telling them". Three levels, each quieter than the last:
// 1 the action, Where to?, with your places as one-tap destinations;
// 2 the answer, a line per place where something changes plans right now, and nothing at all when nothing does;
// 3 the details, opened in place: a place's Events, an Event's card, its Details.
// Only what changes plans reaches Home (an Event's Decision); the rest is on Around and its map.

// Rows a place shows when opened; the rest are on Around.
const ROWS = 4;
// Lines on Home at most: more places than that is a list, not a glance.
const LINES = 3;

export function Home() {
  const { t } = useTranslation();
  const { places, add, remove } = usePlaces();
  const here = useHere(places?.length === 0);
  const [open, setOpen] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  // With no places saved, where you are stands in for them.
  const watched: SavedPlace[] = places?.length ? places : here ? [{ name: t("homeHere"), ...here }] : [];

  return (
    <div className="signage">
      <main className="home">
        <header className="home-head">
          <span className="home-mark">Pulse</span>
        </header>

        <nav className="home-go" aria-label={t("whereTo")}>
          <Link to="/around" search={{ trip: true }} className="home-where">
            <span>{t("whereTo")}</span>
            <span aria-hidden>→</span>
          </Link>
          <div className="home-places">
            {places?.map((p) =>
              editing ? (
                <button key={p.name} type="button" className="home-place home-place-remove" onClick={() => remove(p.name)} aria-label={t("homeRemovePlace", { name: p.name })}>
                  {p.name} <span aria-hidden>×</span>
                </button>
              ) : (
                <Link key={p.name} to="/around" search={{ trip: true, to: formatAt(p), toName: p.name }} className="home-place">
                  {p.name}
                </Link>
              ),
            )}
            {!editing && (places?.length ?? 0) < MAX_PLACES && (
              <button type="button" className="home-place home-place-quiet" onClick={() => setAdding(true)} aria-expanded={adding}>
                {t("homeAddPlace")}
              </button>
            )}
            {!!places?.length && (
              <button type="button" className="home-place home-place-quiet" onClick={() => setEditing(!editing)}>
                {editing ? t("homeDonePlaces") : t("homeEditPlaces")}
              </button>
            )}
          </div>
          {adding && (
            <AddPlace
              near={places?.[0] ?? here}
              suggested={["Home", "Work"].find((n) => !places?.some((p) => p.name === n)) ?? ""}
              onSave={(place) => {
                add(place);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {places?.length === 0 && !adding && <p className="home-prompt">{t("homeAddPrompt")}</p>}
        </nav>

        <PlaceLines places={watched.slice(0, LINES)} open={open} onToggle={(name) => setOpen(open === name ? undefined : name)} />

        <Link to="/around" className="home-around">
          {t("homeAround")} ›
        </Link>
      </main>
    </div>
  );
}

// Where the device is, when it's allowed to say without asking: Home never asks for location on its own.
function useHere(wanted: boolean): LatLon | undefined {
  const { location } = usePlatform();
  const { data } = useQuery({
    queryKey: ["here"],
    enabled: wanted,
    queryFn: async () => ((await location.allowed()) ? location.current() : null),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? undefined;
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
  const loading = found.some((f) => f.events === undefined);
  const lines = found.filter((f) => f.events?.length);
  if (!places.length) return null;
  if (!lines.length) return loading ? <p className="home-quiet">{t("homeChecking")}</p> : null;
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
        <Link to="/around" search={{ at: formatAt(place) }} className="home-all">
          {t("homeAllNear", { count: events.length, place: place.name })} ›
        </Link>
      )}
    </Accordion>
  );
}

// A name and an address, saved on the phone.
function AddPlace({ near, suggested, onSave, onCancel }: { near: LatLon | undefined; suggested: string; onSave: (place: SavedPlace) => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const regions = useRegions();
  // Results near your first place, or where you are, else the middle of the Region: the first place has no other.
  const searchNear = near ?? (regions.data?.[0] ? centreOf(regions.data[0]) : undefined);
  const [name, setName] = useState(suggested);
  const [picked, setPicked] = useState<GeocodeResult>();
  const nameId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (picked && name.trim()) onSave({ name: name.trim(), lat: picked.lat, lon: picked.lon });
  };
  return (
    <form className="home-add" onSubmit={submit} aria-label={t("addPlaceTitle")}>
      <label htmlFor={nameId} className="home-add-label">
        {t("placeName")}
      </label>
      <input id={nameId} className="home-add-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required />
      <AddressSearch point={searchNear} lang={i18n.language} label={t("placeAddress")} onPick={setPicked} autoFocus={!!suggested} />
      <div className="home-add-actions">
        <button type="submit" className="home-add-save" disabled={!picked || !name.trim()}>
          {t("savePlace")}
        </button>
        <button type="button" className="home-add-cancel" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
