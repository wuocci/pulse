import type { GeocodeResult, TravelMode } from "@pulse/client";
import { CalendarClock, ChevronDown, LoaderCircle, LocateFixed, List, LocateIcon, Map as MapIcon, Navigation, Search, X } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddressSearch } from "./AddressSearch.tsx";
import { RADIUS_M, useComingUp, useEvents, useRegions, useTrip } from "./api.ts";
import { EventCard, EventGlance } from "./EventCard.tsx";
import { EventList, type ListRow } from "./EventList.tsx";
import { nearestFirst, pickedText, type Sections, sectionsOf, summaryOf, textIn, tripPins } from "./events.ts";
import { EventPin, PinGroup } from "./map/EventPin.tsx";
import { Legend } from "./MapOverlays.tsx";
import { PointMap, type PointMapProps } from "./map/PointMap.tsx";
import { type LatLon, LocationError, usePlatform } from "./platform.tsx";
import { formatAt, parseAt, usePoint } from "./point.ts";
import { ThemeSetting } from "./ThemeSetting.tsx";
import { HeadsUp, Itineraries, OnTheWay, ParkingNear, parkingDetails, TravelModes, TripForm } from "./TripPanel.tsx";

// Home, summary first: where it looks around and the gist on top, a strip of map (tap it for the whole map), then
// what's in your way, around you and coming up. A card opens in place of the sections. On a wide screen the same
// content sits in a panel beside a big map.

type Locate = "off" | "centred" | "following";

// The place's name, remembered on the device with the point it names: "@here" for the device's location.
const PLACE_KEY = "place";
const HERE = "@here";
type Place = { at: string; name: string };

function parsePlace(value: string | null): Place | undefined {
  try {
    const place: unknown = value ? JSON.parse(value) : undefined;
    return place && typeof place === "object" && "at" in place && "name" in place && typeof place.at === "string" && typeof place.name === "string"
      ? { at: place.at, name: place.name }
      : undefined;
  } catch {
    return undefined;
  }
}

export function Home() {
  const { t } = useTranslation();
  const { location, storage } = usePlatform();
  const { point, setPoint } = usePoint();
  const regions = useRegions();
  const search = useSearch({ from: "/" });
  const { event: selectedId, mode = "transit" } = search;
  const at = search.time && search.time !== "now" ? search.time : undefined;
  const navigate = useNavigate({ from: "/" });
  const events = useEvents(point, at);
  const soon = useComingUp(point);
  const sections = useMemo(() => (point && events.data ? sectionsOf(events.data, soon.data ?? [], point) : undefined), [point, events.data, soon.data]);
  const tripFrom = parseAt(search.from) ?? point;
  const tripTo = parseAt(search.to);
  const trip = useTrip(search.trip ? tripFrom : undefined, search.trip ? tripTo : undefined, at);
  const [locate, setLocate] = useState<Locate>("off");
  const [locating, setLocating] = useState(false);
  const [failure, setFailure] = useState<LocationError["reason"] | null>(null);
  // On a phone, Home shows either the list or the map; a desktop shows both.
  const [mapView, setMapView] = useState(false);
  const [place, setPlace] = useState<Place>();

  const setPointRef = useRef(setPoint);
  useEffect(() => {
    setPointRef.current = setPoint;
  }, [setPoint]);

  const moveTo = (to: LatLon, name: string) => {
    setPointRef.current(to);
    const next = { at: formatAt(to), name };
    setPlace(next);
    void storage.set(PLACE_KEY, JSON.stringify(next));
  };
  const moveToRef = useRef(moveTo);
  moveToRef.current = moveTo;

  // On opening: the device's location when it's allowed, unless a link names the place or a place was chosen by
  // hand last time.
  const linkedAt = useRef(search.at);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = parsePlace(await storage.get(PLACE_KEY));
      if (cancelled) return;
      if (stored) setPlace(stored);
      if (linkedAt.current || (stored && stored.name !== HERE) || !(await location.allowed())) return;
      try {
        const fix = await location.current();
        if (!cancelled) moveToRef.current(fix, HERE);
      } catch {
        // Quietly stays where it was: the locate button explains when tapped.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location, storage]);

  useEffect(() => {
    if (locate !== "following") return;
    return location.watch(
      (fix) => moveToRef.current(fix, HERE),
      (error) => {
        setFailure(error.reason);
        setLocate("off");
      },
    );
  }, [locate, location]);

  const goHere = async (): Promise<boolean> => {
    setFailure(null);
    setLocating(true);
    try {
      moveTo(await location.current(), HERE);
      return true;
    } catch (error) {
      setFailure(error instanceof LocationError ? error.reason : "unavailable");
      return false;
    } finally {
      setLocating(false);
    }
  };

  const onLocate = async () => {
    setFailure(null);
    if (locate === "centred") return setLocate("following");
    if (locate === "following") return setLocate("off");
    if (await goHere()) setLocate("centred");
  };

  const choosePlace = (to: LatLon, name = "") => {
    setLocate("off");
    moveTo(to, name);
  };

  const openTrip = () => void navigate({ search: (prev) => ({ ...prev, trip: true }) });
  const closeTrip = () =>
    void navigate({
      search: (prev) => ({ ...prev, trip: undefined, to: undefined, toName: undefined, from: undefined, fromName: undefined, mode: undefined }),
      replace: true,
    });
  const setTripEnd = (end: "from" | "to") => (picked: GeocodeResult) =>
    void navigate({ search: (prev) => ({ ...prev, [end]: formatAt(picked), [`${end}Name`]: picked.name }), replace: true });
  const setTime = (next: string | undefined) => void navigate({ search: (prev) => ({ ...prev, time: next }), replace: true });

  // Focus goes back where the card was opened from: its pin, or its row in a list.
  const returnTo = useRef<HTMLElement | null>(null);
  const select = (id: string) => {
    if (!selectedId) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMapView(false);
    void navigate({ search: (prev) => ({ ...prev, event: id }) });
  };
  const closeCard = () => {
    if (selectedId) void navigate({ search: (prev) => ({ ...prev, event: undefined }) });
  };
  const wasSelected = useRef(selectedId);
  useEffect(() => {
    const closed = wasSelected.current;
    wasSelected.current = selectedId;
    if (!closed || selectedId) return;
    const back = returnTo.current?.isConnected ? returnTo.current : document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(closed)}"]`);
    back?.focus();
  }, [selectedId]);

  const languages = useMemo(
    () => [...navigator.languages.map((l) => l.split("-")[0]!), ...(regions.data?.[0]?.languages ?? [])],
    [regions.data],
  );
  const recommended = trip.data?.recommended;
  const shownIndex = (m: TravelMode) => (m === mode && search.route !== undefined ? search.route : recommended?.mode === m ? recommended.index : 0);
  const plan = search.trip ? trip.data?.plans.find((p) => p.mode === mode) : undefined;
  const itinerary = plan ? (plan.itineraries[shownIndex(mode)] ?? plan.itineraries[0]) : undefined;
  const avoids = (() => {
    if (!trip.data || !recommended) return undefined;
    const ways = trip.data.plans.flatMap((p) => p.itineraries);
    const fastest = ways.reduce<(typeof ways)[number] | undefined>((a, b) => (!a || Date.parse(b.end) < Date.parse(a.end) ? b : a), undefined);
    const better = trip.data.plans.find((p) => p.mode === recommended.mode)?.itineraries[recommended.index];
    const inWay = (way: typeof fastest) => new Set(way?.onTheWay.filter((m) => m.impact === "consider" || m.impact === "major").map((m) => m.eventId));
    const [onFastest, onBetter] = [inWay(fastest), inWay(better)];
    const avoided = trip.data.events.filter((e) => onFastest.has(e.id) && !onBetter.has(e.id));
    const rank = { info: 0, minor: 1, consider: 2, major: 3 };
    const worst = avoided.sort((a, b) => rank[b.severity] - rank[a.severity])[0];
    return worst && textIn(worst.title, languages);
  })();
  const onTrip = useMemo(
    () => (search.trip ? tripPins(itinerary?.onTheWay ?? [], trip.data?.events ?? []) : undefined),
    [search.trip, itinerary, trip.data],
  );
  const listed = useMemo(() => (sections ? [...sections.inYourWay, ...sections.aroundYou, ...sections.comingUp] : []), [sections]);
  const selected = search.trip ? onTrip?.find((p) => p.event.id === selectedId)?.event : listed.find((e) => e.id === selectedId);
  // On the map: what's going on at the time, and a coming-up Event while its card is open.
  const around = useMemo(() => {
    if (search.trip || !point || !sections) return [];
    const upcoming = sections.comingUp.filter((e) => e.id === selectedId);
    return nearestFirst([...sections.inYourWay, ...sections.aroundYou, ...upcoming], point);
  }, [search.trip, point, sections, selectedId]);
  const pins = onTrip ?? around;
  const titleOf = (id: string) => {
    const event = trip.data?.events.find((e) => e.id === id);
    return event && textIn(event.title, languages);
  };
  const parking = mode === "car" && itinerary?.legs.every((leg) => leg.mode === "car" || leg.mode === "walk") ? trip.data?.parking : undefined;
  const parkingOnMap = useMemo(
    () => parking && { picks: parking.picks, places: (parking.street?.places ?? []).map((spot) => ({ ...spot, label: parkingDetails(spot, t) })) },
    [parking, t],
  );
  const [focus, setFocus] = useState<NonNullable<PointMapProps["focus"]>>();
  const zoomTo = ({ lat, lon }: LatLon) => setFocus((prev) => ({ lat, lon, key: (prev?.key ?? 0) + 1 }));
  // The map centres on the Event whose card opens, and goes back to where it was when the card closes.
  const selectedPin = pins.find((p) => p.event.id === selectedId);
  const selectedAt = selectedPin && `${selectedPin.lngLat[1]},${selectedPin.lngLat[0]}`;
  const centred = useRef(false);
  useEffect(() => {
    const [lat, lon] = selectedAt?.split(",").map(Number) ?? [];
    if (lat !== undefined && lon !== undefined) {
      centred.current = true;
      setFocus((prev) => ({ lat, lon, remember: true, key: (prev?.key ?? 0) + 1 }));
    } else if (!selectedId && centred.current) {
      centred.current = false;
      setFocus((prev) => ({ back: true, key: (prev?.key ?? 0) + 1 }));
    }
  }, [selectedAt, selectedId]);
  // The Event pointed at in the list: shown on the map.
  const [highlighted, setHighlighted] = useState<string>();
  // The Event pointed at on the map, by its pin or its shape: a glance at it pops up from the pin. It lingers a
  // moment after the pointer leaves, so the pointer can move onto it, and Escape puts it away.
  const [glance, setGlance] = useState<{ eventId: string; pinKey: string }>();
  const glanceClosing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const glanceAt = (next: { eventId: string; pinKey: string } | undefined) => {
    clearTimeout(glanceClosing.current);
    if (next) setGlance(next);
    else glanceClosing.current = setTimeout(() => setGlance(undefined), GLANCE_LINGER_MS);
  };
  useEffect(() => () => clearTimeout(glanceClosing.current), []);
  useEffect(() => {
    if (!glance) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setGlance(undefined);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [glance]);
  const glancePin = glance && glance.eventId !== selectedId ? pins.find((p) => p.key === glance.pinKey) : undefined;
  const timeZone = regions.data?.[0]?.timeZone ?? "UTC";

  // The place by name: the device's location or an address picked; undefined for a spot without one.
  const placeName = (() => {
    if (locate !== "off") return t("currentLocation");
    if (!place || !point || place.at !== formatAt(point)) return undefined;
    return place.name === HERE ? t("currentLocation") : place.name || undefined;
  })();

  // The summary line; null while it's still looking around.
  const status = (() => {
    if (search.trip) {
      if (tripTo && trip.isFetching && !itinerary) return t("findingRoutes");
      if (!itinerary) return "";
      const count = onTrip?.length ?? 0;
      return count ? t("statusTrip", { count }) : t("statusTripClear");
    }
    if (events.isError) return t("statusError");
    if (!sections) return null;
    const summary = summaryOf(sections);
    if (summary.key === "summaryNothing") return t(at ? "summaryNothingThen" : "summaryNothingNow");
    const text = placeName ? t("summaryInWayNear", { count: summary.count, place: placeName }) : t("summaryInWay", { count: summary.count });
    return summary.major ? t("summaryMajor", { summary: text, count: summary.major }) : text;
  })();

  const locateLabel = { off: t("goToMyLocation"), centred: t("followMyLocation"), following: t("followingYourLocation") }[locate];
  const LocateGlyph = { off: LocateIcon, centred: LocateFixed, following: Navigation }[locate];
  const lang = languages[0] ?? "en";
  const card = selected ? <EventCard event={selected} languages={languages} timeZone={timeZone} onClose={closeCard} /> : null;
  const listProps = { point, selectedId, languages, timeZone, onSelect: select, onHighlight: setHighlighted };

  return (
    <main className="relative grid h-dvh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground [grid-template-areas:'head'_'main'] lg:grid-cols-[26rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:[grid-template-areas:'head_map'_'body_map']">
      <h1 className="sr-only">{t("appName")}</h1>
      <div className={`space-y-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] [grid-area:head] lg:border-r ${mapView ? "pointer-events-none absolute inset-x-0 top-0 z-10 *:pointer-events-auto lg:pointer-events-auto lg:static" : ""}`}>
        {search.trip ? (
          <div className={mapView ? "max-lg:hidden" : undefined}>
            <TripForm point={point} lang={lang} fromName={search.fromName} toName={search.toName} onFrom={setTripEnd("from")} onTo={setTripEnd("to")} onClose={closeTrip} />
          </div>
        ) : (
          <PlaceChip name={placeName ?? t("chosenPlace")} point={point} lang={lang} locating={locating} onHere={() => void goHere().then((ok) => ok && setLocate("off"))} onPick={(p) => choosePlace(p, p.name)} />
        )}
        <p role="status" className={`flex min-h-5 items-center gap-1.5 font-medium ${mapView ? "max-lg:sr-only" : ""}`}>
          {status === null ? (
            <>
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              {t("lookingAround")}
            </>
          ) : (
            status
          )}
        </p>
        {!search.trip && (
          <button
            type="button"
            onClick={openTrip}
            className={`flex h-12 w-full items-center gap-2 rounded-full border bg-card px-4 text-left text-base text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring ${mapView ? "max-lg:hidden" : ""}`}
          >
            <Search aria-hidden className="size-5 shrink-0" />
            {t("whereTo")}
          </button>
        )}
        <TimeControl at={at} leave={search.trip === true} onChange={setTime} />
        {regions.isError && (
          <p role="alert" className="text-sm">
            {t("regionsFailed")}
          </p>
        )}
        {failure && (
          <p role="alert" className="text-sm">
            {t(failure === "denied" ? "locationDenied" : "locationUnavailable")}
          </p>
        )}
      </div>
      <div className={`[grid-area:main] max-lg:[&_.maplibregl-ctrl-bottom-right]:mb-24! lg:relative lg:block! lg:[grid-area:map] [&_.maplibregl-ctrl-bottom-right]:mb-0! ${mapView ? "absolute inset-0 block" : "hidden"}`}>
        <PointMap
          point={point}
          onLongPress={(to) => choosePlace(to)}
          onPan={() => setLocate("off")}
          onMapClick={closeCard}
          pins={pins}
          {...(itinerary ? { route: itinerary.legs } : {})}
          {...(parkingOnMap ? { parking: parkingOnMap } : {})}
          {...(search.trip && tripTo ? { destination: { ...tripTo, name: search.toName ?? t("to") } } : {})}
          {...(focus ? { focus } : {})}
          renderPin={(pin) => (
            <EventPin
              pin={pin}
              languages={languages}
              selected={pin.event.id === selectedId}
              highlighted={pin.event.id === highlighted || pin.key === glancePin?.key}
              onSelect={() => select(pin.event.id)}
              onHover={(on) => glanceAt(on ? { eventId: pin.event.id, pinKey: pin.key } : undefined)}
            />
          )}
          renderGroup={(group, zoomIn) => <PinGroup pins={group} languages={languages} zoomIn={zoomIn} onSelect={select} />}
          onShapeClick={select}
          onShapeHover={glanceAt}
          emphasised={[...new Set([selectedId, highlighted, glancePin?.event.id])].filter((id): id is string => id !== undefined)}
          {...(glancePin
            ? {
                popup: {
                  pinKey: glancePin.key,
                  content: (
                    <div onPointerEnter={() => clearTimeout(glanceClosing.current)} onPointerLeave={() => glanceAt(undefined)}>
                      <EventGlance
                        event={glancePin.event}
                        languages={languages}
                        timeZone={timeZone}
                        onOpen={() => {
                          setGlance(undefined);
                          select(glancePin.event.id);
                        }}
                      />
                    </div>
                  ),
                },
              }
            : {})}
          {...(highlighted ? { reveal: highlighted } : {})}
          {...(!search.trip ? { radiusM: RADIUS_M } : {})}
        />
        <div className="pointer-events-none absolute top-0 right-0 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <Legend radiusM={search.trip ? undefined : RADIUS_M} />
        </div>
        <div className="absolute right-0 bottom-36 flex flex-col items-center gap-2 p-4 lg:bottom-8">
          <ThemeSetting align="right" className="max-lg:hidden" />
          <Button
            variant={locate === "following" ? "default" : "secondary"}
            size="icon"
            className="size-11 rounded-full shadow"
            aria-label={locating ? t("locating") : locateLabel}
            aria-pressed={locate === "following"}
            disabled={locating}
            onClick={onLocate}
          >
            <LocateGlyph aria-hidden className={locate === "following" ? "fill-current" : undefined} />
          </Button>
        </div>
      </div>
      <div className={`overflow-y-auto p-4 pb-28 [grid-area:main] lg:pb-[max(1rem,env(safe-area-inset-bottom))] lg:block! lg:border-r lg:[grid-area:body] ${mapView ? "hidden" : "block"}`}>
        {card && <div className="rounded-3xl border bg-card">{card}</div>}
        <div hidden={card !== null} className="space-y-5">
          {search.trip ? (
            tripTo && (
              <div className="space-y-4">
                {trip.isError ? (
                  <p role="alert" className="text-sm">
                    {t("tripFailed")}
                  </p>
                ) : (
                  <TravelModes
                    trip={trip.data}
                    mode={mode}
                    shownIndex={shownIndex}
                    onMode={(next) => void navigate({ search: (prev) => ({ ...prev, mode: next, route: undefined }), replace: true })}
                  />
                )}
                {trip.isPending ? (
                  <p aria-hidden className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    {t("findingRoutes")}
                  </p>
                ) : (
                  plan && (
                    <>
                      <Itineraries
                        itineraries={plan.itineraries}
                        titleOf={titleOf}
                        chosen={shownIndex(mode)}
                        {...(recommended?.mode === mode ? { better: { index: recommended.index, ...(avoids ? { avoids } : {}) } } : {})}
                        timeZone={timeZone}
                        onChoose={(index) => void navigate({ search: (prev) => ({ ...prev, route: index }), replace: true })}
                      />
                      {itinerary && <HeadsUp comingUp={itinerary.comingUp} titleOf={titleOf} legs={itinerary.legs} timeZone={timeZone} />}
                      {parking && <ParkingNear parking={parking} place={search.toName ?? t("to")} onPick={zoomTo} />}
                      {itinerary && onTrip && (
                        <OnTheWay legs={itinerary.legs} pins={onTrip} selectedId={selectedId} languages={languages} timeZone={timeZone} onSelect={select} onHighlight={setHighlighted} />
                      )}
                    </>
                  )
                )}
              </div>
            )
          ) : (
            sections && <SectionTabs sections={sections} {...listProps} />
          )}
        </div>
      </div>
      <ThemeSetting align="left" className="fixed! bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-4 z-30 lg:hidden" />
      <ListOrMap map={mapView} onChange={setMapView} />
    </main>
  );
}

// A phone's switch between the list and the map.
function ListOrMap({ map, onChange }: { map: boolean; onChange: (map: boolean) => void }) {
  const { t } = useTranslation();
  const side = (on: boolean) =>
    `flex h-12 items-center justify-center gap-2 rounded-full px-6 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "bg-muted text-brand" : "text-foreground"}`;
  return (
    <div
      role="group"
      aria-label={t("showAs")}
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 rounded-full border bg-card/90 p-1.5 shadow-xl backdrop-blur lg:hidden"
    >
      <button type="button" aria-pressed={!map} onClick={() => onChange(false)} className={side(!map)}>
        <List aria-hidden className="size-5" />
        {t("listView")}
      </button>
      <button type="button" aria-pressed={map} onClick={() => onChange(true)} className={side(map)}>
        <MapIcon aria-hidden className="size-5" />
        {t("mapView")}
      </button>
    </div>
  );
}

interface PlaceChipProps {
  name: string;
  point: LatLon | undefined;
  lang: string;
  locating: boolean;
  onHere: () => void;
  onPick: (place: GeocodeResult) => void;
}

// "Near: Current location ▾": where Home looks around. Opens to the device's location or an address.
function PlaceChip({ name, point, lang, locating, onHere, onPick }: PlaceChipProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex h-10 max-w-full items-center gap-1.5 rounded-full border bg-card/90 px-4 text-sm font-medium shadow-sm backdrop-blur outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{t("placeChip", { place: name })}</span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id} role="group" aria-label={t("placeTitle")} className="mt-2 space-y-2 rounded-3xl border bg-card p-3 shadow-xl">
          <Button
            variant="secondary"
            className="h-11 w-full justify-start"
            disabled={locating}
            onClick={() => {
              onHere();
              setOpen(false);
            }}
          >
            <LocateFixed aria-hidden />
            {locating ? t("locating") : t("useMyLocation")}
          </Button>
          <AddressSearch
            point={point}
            lang={lang}
            autoFocus
            onPick={(place) => {
              onPick(place);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// Now, or a picked date and time from the phone's own picker. A picked time shows what's going on at that moment; on
// a Trip (`leave`) it's when to leave.
function TimeControl({ at, leave, onChange }: { at: string | undefined; leave: boolean; onChange: (at: string | undefined) => void }) {
  const { t } = useTranslation();
  const chip = (on: boolean) =>
    `flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring ${on ? "border-foreground bg-foreground text-background" : "bg-card/90 backdrop-blur"}`;

  return (
    <div role="group" aria-label={t(leave ? "leaveWhen" : "time")} className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={!at} onClick={() => onChange(undefined)} className={`${chip(!at)} outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
        {t(leave ? "leaveNow" : "timeNow")}
      </button>
      <span className={`relative ${chip(at !== undefined)}`}>
        <CalendarClock aria-hidden className="size-4" />
        {at ? (leave ? t("leavingAt", { time: pickedText(at) }) : pickedText(at)) : t(leave ? "leaveAt" : "pickTime")}
        <input
          type="datetime-local"
          aria-label={at ? t(leave ? "leavingAt" : "pickedTime", { time: pickedText(at) }) : t(leave ? "leaveAt" : "pickTime")}
          value={at ?? ""}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              // Already open, or the browser won't: the field still takes typing.
            }
          }}
          className={`absolute inset-y-0 left-0 cursor-pointer opacity-0 ${at ? "right-10" : "right-0"}`}
        />
        {at && (
          <button
            type="button"
            aria-label={t("backToNow")}
            onClick={() => onChange(undefined)}
            className="-mr-2.5 grid size-8 place-items-center rounded-full outline-none hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </span>
    </div>
  );
}

type SectionKey = keyof Sections;
// How long a glance stays after the pointer leaves its pin, shape or itself.
const GLANCE_LINGER_MS = 250;
// The tab an Event's row is in, if any.
const holdingOf = (sections: Sections, id: string | undefined) => (id ? SECTIONS.find(({ key }) => sections[key].some((e) => e.id === id))?.key : undefined);
const SECTIONS: { key: SectionKey; lead: "until" | "distance" | "starts"; empty: "emptyInYourWay" | "emptyAroundYou" | "emptyComingUp" }[] = [
  { key: "inYourWay", lead: "until", empty: "emptyInYourWay" },
  { key: "aroundYou", lead: "distance", empty: "emptyAroundYou" },
  { key: "comingUp", lead: "starts", empty: "emptyComingUp" },
];

interface SectionTabsProps {
  sections: Sections;
  point: LatLon | undefined;
  selectedId: string | undefined;
  languages: readonly string[];
  timeZone: string;
  onSelect: (id: string) => void;
  onHighlight: (id: string | undefined) => void;
}

// Home's sections as tabs, each with its count: In your way, Around you, Coming up. Opens on the first with anything,
// and moves to the one holding an Event chosen on the map, so its row is there when the card closes.
function SectionTabs({ sections, point, ...list }: SectionTabsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [chosen, setChosen] = useState<SectionKey>();
  const active = chosen ?? SECTIONS.find(({ key }) => sections[key].length)?.key ?? "inYourWay";
  const { selectedId } = list;
  useEffect(() => {
    const holding = holdingOf(sections, selectedId);
    if (holding) setChosen(holding);
  }, [selectedId, sections]);
  const events = sections[active];
  const rows = useMemo((): ListRow[] => {
    const distances = new Map<string, number>();
    if (point) for (const pin of nearestFirst(events, point)) if (!distances.has(pin.event.id)) distances.set(pin.event.id, pin.distanceM);
    return events.map((event) => {
      const distanceM = distances.get(event.id);
      return distanceM === undefined ? { event } : { event, distanceM };
    });
  }, [events, point]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys move between the tabs, as tabs do.
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const next = SECTIONS[(i + step + SECTIONS.length) % SECTIONS.length]!;
    setChosen(next.key);
    tabs.current[SECTIONS.indexOf(next)]?.focus();
  };
  const current = SECTIONS.find(({ key }) => key === active)!;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label={t("sectionTabs")} className="flex gap-1 rounded-full border bg-card p-1">
        {SECTIONS.map(({ key }, i) => (
          <button
            key={key}
            ref={(el) => void (tabs.current[i] = el)}
            type="button"
            role="tab"
            id={`${id}-${key}`}
            aria-selected={key === active}
            aria-controls={`${id}-panel`}
            tabIndex={key === active ? 0 : -1}
            onClick={() => setChosen(key)}
            onKeyDown={(e) => onKey(e, i)}
            className="flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-foreground aria-selected:text-background"
          >
            <span className="truncate">{t(key)}</span>{" "}
            <span className="tabular-nums opacity-70">{sections[key].length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`}>
        {events.length ? (
          <EventList label={t(active)} pins={rows} lead={current.lead} {...list} />
        ) : (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t(current.empty)}</p>
        )}
      </div>
    </div>
  );
}
