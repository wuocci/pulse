import type { Event, GeocodeResult, TravelMode } from "@pulse/client";
import { CalendarClock, ChevronDown, LoaderCircle, LocateFixed, List, LocateIcon, Map as MapIcon, MapPin, Navigation, Search, Star, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddressSearch } from "./AddressSearch.tsx";
import { RADIUS_M, useAddressAt, useComingUp, useEvents, useRegions, useTrip } from "./api.ts";
import { EventGlance } from "./EventCard.tsx";
import { distance } from "./rowWords.ts";
import { Accordion, EventRow } from "./EventRows.tsx";
import { metresBetween, nearestFirst, pickedText, readingLanguages, type RowValue, type Sections, sectionsOf, startsOf, summaryOf, textIn, tripPins, untilOf } from "./events.ts";
import { EventPin, PinGroup } from "./map/EventPin.tsx";
import { Legend } from "./MapOverlays.tsx";
import { PointMap, type PointMapProps } from "./map/PointMap.tsx";
import { type LatLon, LocationError, usePlatform } from "./platform.tsx";
import { formatAt, parseAt, usePoint } from "./point.ts";
import { useRenewRoutines } from "./routines.ts";
import { SettingsButton } from "./Settings.tsx";
import { PlaceForm, PlacesRow, YourPlaces } from "./Places.tsx";
import { type SavedPlace, savedAt, usePlaces } from "./places.ts";
import { parkingDetails, TripForm, TripRoute } from "./TripPanel.tsx";
import { TripResult } from "./TripResult.tsx";
import { ALL_MODES, useSpeeds, useTravelModes } from "./travelModes.ts";
import { arrivalOf, avoidedBy, bestOf, itineraryOf, type Step, stepsOf, type Way } from "./trips.ts";
import { WaySteps } from "./WaySteps.tsx";

// Around, summary first: where it looks around and the gist on top, a strip of map (tap it for the whole map), then
// what's in your way, around you and coming up, each card opening in place. A Trip shows its one recommendation
// instead (TripResult). On a wide screen the same
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

export function Around() {
  const { t, i18n } = useTranslation();
  const { location, storage } = usePlatform();
  const { point, setPoint } = usePoint();
  const regions = useRegions();
  // Opening the app keeps this phone's Routines (ADR 0013).
  useRenewRoutines();
  const search = useSearch({ from: "/" });
  const { event: selectedId } = search;
  const at = search.time && search.time !== "now" ? search.time : undefined;
  const navigate = useNavigate({ from: "/" });
  const events = useEvents(point, at);
  const soon = useComingUp(point);
  const sections = useMemo(() => (point && events.data ? sectionsOf(events.data, soon.data ?? [], point) : undefined), [point, events.data, soon.data]);
  const tripFrom = parseAt(search.from) ?? point;
  const tripTo = parseAt(search.to);
  const { modes: usualModes } = useTravelModes();
  const { speeds } = useSpeeds();
  // Every mode is the API's default: asked by name only when some are left out.
  const tripModes = usualModes && usualModes.length < ALL_MODES.length ? usualModes : undefined;
  const trip = useTrip(search.trip && usualModes && speeds ? tripFrom : undefined, search.trip ? tripTo : undefined, at, {
    arrive: search.arrive === true,
    ...(tripModes ? { modes: tripModes } : {}),
    ...(speeds ? { speeds } : {}),
  });
  // The Trip as planned, with how fast you walk: a drive's walk from parking is timed at it.
  // Arriving by a time, the best way is the one that lets you leave latest.
  const arriveBy = search.arrive && at ? new Date(at).getTime() : undefined;
  const planned = useMemo(() => trip.data && { ...trip.data, walkKmh: speeds?.walk, arriveBy }, [trip.data, speeds?.walk, arriveBy]);
  const [locate, setLocate] = useState<Locate>("off");
  const [locating, setLocating] = useState(false);
  const [failure, setFailure] = useState<LocationError["reason"] | null>(null);
  // On a phone, Around shows either the list or the map; a desktop shows both. The list comes first: the map is
  // for a way to show (switched to with List/Map), or for one Event (Show on map, with the way back to the list).
  const [mapChosen, setMapView] = useState(false);
  // A Trip with nowhere to go yet has nothing to list: its fields are over the map, which can pick the place too.
  const choosingTo = !!search.trip && !tripTo;
  const mapView = mapChosen || choosingTo;
  const [place, setPlace] = useState<Place>();
  // On a phone's map, a Trip's From and To fold to one line once there's a way to show; tapping it opens them.
  const [editing, setEditing] = useState(false);
  // Where the map was long-pressed: it asks what to do there.
  const [pressed, setPressed] = useState<LatLon>();
  const { places } = usePlaces();

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
  const setTripEnd = (end: "from" | "to") => (picked: GeocodeResult) => {
    setEditing(false);
    // Picked over the map: the way is shown there.
    if (choosingTo) setMapView(true);
    void navigate({ search: (prev) => ({ ...prev, [end]: formatAt(picked), [`${end}Name`]: picked.name }), replace: true });
  };
  const setTime = (next: string | undefined, arrive = false) =>
    void navigate({ search: (prev) => ({ ...prev, time: next, arrive: next && arrive ? true : undefined }), replace: true });
  // The way shown: one chosen among the other ways, else the best.
  const setWay = (way: Partial<Way> | undefined) => void navigate({ search: (prev) => ({ ...prev, mode: way?.mode, route: way?.index }), replace: true });

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
  const closeCardRef = useRef(closeCard);
  closeCardRef.current = closeCard;
  const wasSelected = useRef(selectedId);
  useEffect(() => {
    const closed = wasSelected.current;
    wasSelected.current = selectedId;
    if (!closed || selectedId) return;
    const back = returnTo.current?.isConnected ? returnTo.current : document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(closed)}"]`);
    back?.focus();
  }, [selectedId]);

  const languages = useMemo(() => readingLanguages(i18n.language, regions.data?.[0]?.languages), [i18n.language, regions.data]);
  const best = search.trip && planned ? bestOf(planned) : undefined;
  const shown: Way | undefined = search.mode ? { mode: search.mode, index: search.route ?? (best?.mode === search.mode ? best.index : 0) } : best;
  const mode: TravelMode = shown?.mode ?? "transit";
  const itinerary = search.trip && planned ? itineraryOf(planned, shown) : undefined;
  const avoided = planned ? avoidedBy(planned, best) : undefined;
  const avoids = avoided && textIn(avoided.title, languages);
  const onTrip = useMemo(
    () => (search.trip ? tripPins(itinerary?.onTheWay ?? [], planned?.events ?? []) : undefined),
    [search.trip, itinerary, planned],
  );
  // On the map: what's going on at the time, and a coming-up Event while its card is open.
  const around = useMemo(() => {
    if (search.trip || !point || !sections) return [];
    const upcoming = sections.comingUp.filter((e) => e.id === selectedId);
    return nearestFirst([...sections.inYourWay, ...sections.aroundYou, ...upcoming], point);
  }, [search.trip, point, sections, selectedId]);
  const pins = onTrip ?? around;
  const titleOf = (id: string) => {
    const event = planned?.events.find((e) => e.id === id);
    return event && textIn(event.title, languages);
  };
  const parking = mode === "car" && itinerary?.legs.every((leg) => leg.mode === "car" || leg.mode === "walk") ? planned?.parking : undefined;
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
  const listCardOpen = !!selectedId;
  useEffect(() => {
    if (!listCardOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && closeCardRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [listCardOpen]);
  const glancePin = glance && glance.eventId !== selectedId ? pins.find((p) => p.key === glance.pinKey) : undefined;
  const timeZone = regions.data?.[0]?.timeZone ?? "UTC";

  // The place by name: the device's location or an address picked; undefined for a spot without one.
  const placeName = (() => {
    if (locate !== "off") return t("currentLocation");
    if (!place || !point || place.at !== formatAt(point)) return undefined;
    return place.name === HERE ? t("currentLocation") : place.name || undefined;
  })();
  const fromLabel = search.fromName ?? placeName ?? t("fromHere");
  const steps = planned && shown && itinerary ? stepsOf(itinerary, { from: fromLabel, to: search.toName ?? t("to"), parking: t("tripParkHere") }, arrivalOf(planned, shown.mode, itinerary), parking?.picks[0]) : undefined;
  // A phone's map with a way to show: From and To as one line, the way under it.
  const folded = mapView && !!search.trip && !!itinerary && !editing;

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

  const failureLine = failure && (
    <p role="alert" className="trip-none">
      {t(failure === "denied" ? "locationDenied" : "locationUnavailable")}
    </p>
  );
  const statusLine = (
    <p role="status" className={`around-status ${mapView ? "max-lg:sr-only" : ""}`}>
      {status === null ? (
        <>
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {t("lookingAround")}
        </>
      ) : (
        status
      )}
    </p>
  );
  // The point's address, and where you are when the point isn't: to name the place and say how far it is.
  const address = useAddressAt(search.trip ? undefined : point, languages[0] ?? "en");
  const you = useQuery({
    queryKey: ["you"],
    queryFn: async () => ((await location.allowed()) ? await location.current().catch(() => null) : null),
    retry: false,
    staleTime: 60_000,
  });
  const here = savedAt(places, point);
  // Whose the place is, so the heading can say: your location, one of your places, an address searched, or a spot
  // (picked on the map, or from a link).
  const placeHere = !!place && !!point && place.at === formatAt(point);
  const kind: HereKind = locate !== "off" || (placeHere && place.name === HERE) ? "you" : here ? "saved" : placeHere && place.name ? "searched" : "spot";
  const hereName = here?.name ?? (kind === "searched" ? place?.name : address.data?.name);
  const metres = kind !== "you" && point && you.data ? metresBetween(you.data, point) : undefined;
  const hereDetail = [
    t(`hereKind_${kind}`),
    kind === "saved" || kind === "searched" ? address.data?.label : undefined,
    metres !== undefined ? t("hereAway", { distance: distance(metres, i18n.language) }) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  // A phone switches between the list and the map once a Trip has its answer (a way, or why there's none). Before
  // that there's one screen: the list, or the Trip's fields over the map.
  const canSwitch = !!search.trip && !!tripTo && (!!planned || trip.isError);
  const showOnMap = (id: string) => {
    const pin = pins.find((p) => p.event.id === id);
    if (pin) zoomTo({ lat: pin.lngLat[1], lon: pin.lngLat[0] });
    setMapView(true);
  };
  const goTo = (to: LatLon, name: string) => {
    setPressed(undefined);
    setEditing(false);
    setMapView(true);
    void navigate({ search: (prev) => ({ ...prev, trip: true, to: formatAt(to), toName: name, mode: undefined, route: undefined }) });
  };
  const lookAt = (to: LatLon, name: string) => {
    setPressed(undefined);
    if (search.trip) closeTrip();
    choosePlace(to, name);
  };

  const locateLabel = { off: t("goToMyLocation"), centred: t("followMyLocation"), following: t("followingYourLocation") }[locate];
  const LocateGlyph = { off: LocateIcon, centred: LocateFixed, following: Navigation }[locate];
  const lang = languages[0] ?? "en";

  return (
    <main className="signage around relative grid h-dvh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden [grid-template-areas:'head'_'main'] lg:grid-cols-[26rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:[grid-template-areas:'head_map'_'body_map']">
      <h1 className="sr-only">{t("appName")}</h1>
      {/* An Event shown on a phone's map has the map to itself, with the way back to the list. */}
      <div
        className={`around-head space-y-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] [grid-area:head] ${mapView ? "pointer-events-none absolute inset-x-0 top-0 z-20 *:pointer-events-auto lg:pointer-events-auto lg:static" : "relative z-20"} ${mapView && !search.trip ? "max-lg:hidden" : ""}`}
      >
        {search.trip ? (
          <>
            {folded && <TripRoute fromName={fromLabel} toName={search.toName ?? t("to")} onEdit={() => setEditing(true)} onClose={closeTrip} />}
            <div className={folded ? "max-lg:hidden" : undefined}>
              <TripForm point={point} lang={lang} fromName={search.fromName} toName={search.toName} to={tripTo} onFrom={setTripEnd("from")} onTo={setTripEnd("to")} onClose={closeTrip} />
            </div>
          </>
        ) : (
          <>
            <div className="around-top">
              <span className="home-mark">{t("appName")}</span>
            </div>
          </>
        )}
        {search.trip && statusLine}
        {!search.trip && (
          <button type="button" onClick={openTrip} className="around-where">
            <span>{t("whereTo")}</span>
            <span aria-hidden>→</span>
          </button>
        )}
        {!search.trip && <PlacesRow />}
        {/* On a Trip, when to go is asked with where: the suggestions open over it. */}
        {search.trip && (
          <div className={folded ? "max-lg:hidden" : undefined}>
            <TimeControl at={at} arrive={search.arrive === true} trip onChange={setTime} />
          </div>
        )}
        {folded && planned && shown && itinerary && (
          <WayOnMap
            isBest={!!best && best.mode === shown.mode && best.index === shown.index}
            mode={shown.mode}
            leave={itinerary.start}
            arrive={arrivalOf(planned, shown.mode, itinerary)}
            steps={steps ?? []}
            timeZone={timeZone}
            onBest={() => setWay(undefined)}
            onStep={zoomTo}
          />
        )}
        {regions.isError && (
          <p role="alert" className="trip-none">
            {t("regionsFailed")}
          </p>
        )}
        {/* Your location failing is said where it was asked for: on the start screen, under the place's heading. */}
        {failure && (search.trip || mapView) && failureLine}
      </div>
      <div className={`[grid-area:main] max-lg:[&_.maplibregl-ctrl-bottom-right]:mb-24! lg:relative lg:block! lg:[grid-area:map] [&_.maplibregl-ctrl-bottom-right]:mb-0! ${mapView ? "absolute inset-0 block" : "hidden"}`}>
        <PointMap
          point={point}
          // A long press asks: go there, look around there, or save it.
          onLongPress={setPressed}
          onPan={() => setLocate("off")}
          onMapClick={() => {
            setPressed(undefined);
            closeCard();
          }}
          pins={pins}
          {...(itinerary ? { route: itinerary.legs } : {})}
          {...(parkingOnMap ? { parking: parkingOnMap } : {})}
          {...(pressed
            ? { destination: { ...pressed, name: t("pointOnMap") } }
            : search.trip && tripTo
              ? { destination: { ...tripTo, name: search.toName ?? t("to") } }
              : {})}
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
          <SettingsButton className="max-lg:hidden" />
          <button
            type="button"
            className="map-btn"
            aria-label={locating ? t("locating") : locateLabel}
            aria-pressed={locate === "following"}
            disabled={locating}
            onClick={onLocate}
          >
            <LocateGlyph aria-hidden className={`size-5 ${locate === "following" ? "fill-current" : ""}`} />
          </button>
        </div>
      </div>
      <div className={`around-body overflow-y-auto p-4 pb-28 [grid-area:main] lg:pb-[max(1rem,env(safe-area-inset-bottom))] lg:block! lg:[grid-area:body] ${mapView ? "hidden" : "block"}`}>
        {search.trip ? (
          tripTo &&
          (trip.isError ? (
            <p role="alert" className="trip-none">
              {t("tripFailed")}
            </p>
          ) : !planned || !usualModes ? (
            <p aria-hidden className="trip-none">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              {t("findingRoutes")}
            </p>
          ) : (
            <TripResult
              trip={planned}
              best={best}
              shown={shown}
              avoids={avoids}
              from={tripFrom ?? tripTo}
              to={tripTo}
              toName={search.toName ?? t("to")}
              steps={steps ?? []}
              onStep={(to) => {
                zoomTo(to);
                setMapView(true);
              }}
              onTrip={onTrip ?? []}
              selectedId={selectedId}
              timeZone={timeZone}
              titleOf={titleOf}
              parking={parking}
              onSelect={select}
              onClose={closeCard}
              onHighlight={setHighlighted}
              onWay={(way) => {
                setWay(way);
                // Another way is seen on the map: a phone switches to it, with the way back on top.
                if (way) setMapView(true);
              }}
              onPick={zoomTo}
            />
          ))
        ) : (
          <>
            <YourPlaces />
            <section className="here" aria-labelledby="here-heading">
              <HereHeading
                name={hereName}
                kind={kind}
                saved={!!here}
                detail={hereDetail}
                places={places ?? []}
                point={point}
                lang={lang}
                locating={locating}
                onHere={() => void goHere().then((ok) => ok && setLocate("off"))}
                onPick={(p, name) => choosePlace(p, name)}
              />
              {!mapView && failureLine}
              <TimeControl at={at} arrive={false} trip={false} onChange={setTime} />
              {statusLine}
              {sections && (
                <SectionList
                  sections={sections}
                  point={point}
                  selectedId={selectedId}
                  timeZone={timeZone}
                  onSelect={select}
                  onClose={closeCard}
                  onHighlight={setHighlighted}
                  onShowOnMap={showOnMap}
                />
              )}
            </section>
          </>
        )}
      </div>
      <SettingsButton className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-4 z-30 lg:hidden" />
      {canSwitch && <ListOrMap map={mapView} onChange={setMapView} />}
      {!search.trip && mapView && (
        <button type="button" className="around-switch around-back-list" onClick={() => setMapView(false)}>
          ‹ {t("backToList")}
        </button>
      )}
      {pressed && (
        <MapPress
          at={pressed}
          onGo={() => goTo(pressed, t("pointOnMap"))}
          onLook={() => lookAt(pressed, "")}
          onClose={() => setPressed(undefined)}
        />
      )}
    </main>
  );
}

// On a phone's map, the way shown: which, when to leave and arrive, and one tap back to the best way.
interface WayOnMapProps {
  isBest: boolean;
  mode: TravelMode;
  leave: string;
  arrive: number;
  steps: Step[];
  timeZone: string;
  onBest: () => void;
  onStep: (at: LatLon) => void;
}

function WayOnMap({ isBest, mode, leave, arrive, steps, timeZone, onBest, onStep }: WayOnMapProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  return (
    <section aria-label={t("tripOnMap")} className="way-on-map lg:hidden">
      <p className="trip-label">
        {t(isBest ? "tripBest" : "tripChosen")} · {t(`mode_${mode}`)}
      </p>
      <p className="way-on-map-times">
        {t("tripLeave", { time: clock.format(new Date(leave)) })} · {t("tripArrive", { time: clock.format(new Date(arrive)) })}
      </p>
      {!isBest && (
        <button type="button" className="way-on-map-best" onClick={onBest}>
          ‹ {t("tripBackToBest")}
        </button>
      )}
      <Accordion className="way-on-map-steps" open={open} onToggle={() => setOpen(!open)} header={<span>{t("tripSteps")}</span>}>
        {/* A step tapped folds the steps away, so the place it's at is in sight. */}
        <WaySteps
          steps={steps}
          timeZone={timeZone}
          onStep={(at) => {
            setOpen(false);
            onStep(at);
          }}
        />
      </Accordion>
    </section>
  );
}

// A phone's switch between the list and the map.
function ListOrMap({ map, onChange }: { map: boolean; onChange: (map: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("showAs")} className="around-switch lg:hidden">
      <button type="button" aria-pressed={!map} onClick={() => onChange(false)}>
        <List aria-hidden className="size-5" />
        {t("listView")}
      </button>
      <button type="button" aria-pressed={map} onClick={() => onChange(true)}>
        <MapIcon aria-hidden className="size-5" />
        {t("mapView")}
      </button>
    </div>
  );
}

type HereKind = "you" | "saved" | "searched" | "spot";

interface HereHeadingProps {
  name: string | undefined;
  kind: HereKind;
  saved: boolean;
  // Whose the place is, its address, and how far it is from you.
  detail: string;
  places: SavedPlace[];
  point: LatLon | undefined;
  lang: string;
  locating: boolean;
  onHere: () => void;
  onPick: (at: LatLon, name: string) => void;
}

// "Around Kampinkuja 1 · Change", then whose it is: the place the list is about, named, and changed in place: your
// location, one of your places, or an address. Your location is one tap back when it's elsewhere; a place not saved
// yet can be, from here.
function HereHeading({ name, kind, saved, detail, places, point, lang, locating, onHere, onPick }: HereHeadingProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const id = useId();
  // The place by name, else what it is; then whose it is, unless that's what named it.
  const title = name ?? t(kind === "you" ? "hereKind_you" : "hereSpot");
  const sub = name || kind !== "you" ? detail : detail.split(" · ").slice(1).join(" · ");
  const KindIcon = { you: LocateFixed, saved: Star, searched: Search, spot: MapPin }[kind];

  return (
    <div className="here-head">
      <h2 id="here-heading" className="here-label">
        {t("hereLabel")}
      </h2>
      {/* One row says where; tapping it changes it. */}
      <button type="button" aria-expanded={open} aria-controls={id} aria-label={t("hereChangeLabel", { place: title })} onClick={() => setOpen(!open)} className="here-place" data-kind={kind}>
        <KindIcon aria-hidden className="here-place-icon" />
        <span className="here-place-body">
          <span className="here-place-name">{title}</span>
          {sub && <span className="here-place-sub">{sub}</span>}
        </span>
        <span className="here-place-change">
          {t("hereChange")}
          <ChevronDown aria-hidden className={`size-4 shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {(kind !== "you" || (!saved && point)) && (
        <div className="here-actions">
          {kind !== "you" && (
            <button type="button" className="here-action" disabled={locating} onClick={onHere}>
              <LocateFixed aria-hidden className="size-4" />
              {locating ? t("locating") : t("useMyLocation")}
            </button>
          )}
          {!saved && point && (
            <button type="button" className="here-action" aria-expanded={saving} onClick={() => setSaving(!saving)}>
              <Star aria-hidden className="size-4" />
              {t("hereSave")}
            </button>
          )}
        </div>
      )}
      {saving && point && <PlaceForm at={point} name={kind === "searched" || kind === "spot" ? (name ?? "") : ""} onDone={() => setSaving(false)} />}
      {open && (
        <div id={id} role="group" aria-label={t("placeTitle")} className="around-place-panel">
          <button
            type="button"
            className="around-here"
            disabled={locating}
            onClick={() => {
              onHere();
              setOpen(false);
            }}
          >
            <LocateFixed aria-hidden className="size-5" />
            {locating ? t("locating") : t("useMyLocation")}
          </button>
          {places.length > 0 && (
            <div className="home-places" role="group" aria-label={t("yourPlaces")}>
              {places.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="home-place"
                  onClick={() => {
                    onPick(p, p.name);
                    setOpen(false);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <AddressSearch
            point={point}
            lang={lang}
            autoFocus
            onPick={(place) => {
              onPick(place, place.name);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// A long press on the map: go there, look around there, or save it as one of your places.
function MapPress({ at, onGo, onLook, onClose }: { at: LatLon; onGo: () => void; onLook: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  return (
    <section aria-label={t("pointOnMap")} className="map-press">
      <div className="map-press-head">
        <p className="trip-label">{t("pointOnMap")}</p>
        <button type="button" className="map-press-close" aria-label={t("close")} onClick={onClose}>
          <X aria-hidden className="size-5" />
        </button>
      </div>
      {saving ? (
        <PlaceForm at={at} onDone={onClose} />
      ) : (
        <div className="map-press-actions">
          <button type="button" className="map-press-go" onClick={onGo}>
            {t("pressGo")}
          </button>
          <button type="button" onClick={onLook}>
            {t("pressLook")}
          </button>
          <button type="button" onClick={() => setSaving(true)}>
            <Star aria-hidden className="size-4" />
            {t("pressSave")}
          </button>
        </div>
      )}
    </section>
  );
}

// Now, or a picked date and time from the phone's own picker. A picked time shows what's going on at that moment; on
// a Trip it's when to leave, or when to arrive by.
function TimeControl({ at, arrive, trip, onChange }: { at: string | undefined; arrive: boolean; trip: boolean; onChange: (at: string | undefined, arrive?: boolean) => void }) {
  const { t } = useTranslation();
  const leaving = at && !arrive ? at : undefined;
  const arriving = at && arrive ? at : undefined;

  return (
    <div role="group" aria-label={t(trip ? "leaveWhen" : "time")} className="around-time">
      <button type="button" aria-pressed={!at} onClick={() => onChange(undefined)} className="around-chip">
        {t(trip ? "leaveNow" : "timeNow")}
      </button>
      <TimeChip
        value={leaving}
        text={leaving ? (trip ? t("leavingAt", { time: pickedText(leaving) }) : pickedText(leaving)) : t(trip ? "leaveAt" : "pickTime")}
        label={leaving ? t(trip ? "leavingAt" : "pickedTime", { time: pickedText(leaving) }) : t(trip ? "leaveAt" : "pickTime")}
        onPick={(value) => onChange(value)}
        onClear={() => onChange(undefined)}
      />
      {trip && (
        <TimeChip
          value={arriving}
          text={arriving ? t("arrivingBy", { time: pickedText(arriving) }) : t("arriveBy")}
          label={arriving ? t("arrivingBy", { time: pickedText(arriving) }) : t("arriveBy")}
          onPick={(value) => onChange(value, true)}
          onClear={() => onChange(undefined)}
        />
      )}
    </div>
  );
}

// A chip that opens the phone's own date and time picker, and says the time picked.
function TimeChip({ value, text, label, onPick, onClear }: { value: string | undefined; text: string; label: string; onPick: (value: string) => void; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="around-chip relative has-focus-visible:outline-3" data-on={value !== undefined}>
      <CalendarClock aria-hidden className="size-4" />
      {text}
      <input
        type="datetime-local"
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            // Already open, or the browser won't: the field still takes typing.
          }
        }}
        className={`absolute inset-y-0 left-0 cursor-pointer opacity-0 ${value ? "right-10" : "right-0"}`}
      />
      {value && (
        <button type="button" aria-label={t("backToNow")} onClick={onClear} className="around-chip-clear">
          <X aria-hidden className="size-4" />
        </button>
      )}
    </span>
  );
}

type SectionKey = keyof Sections;
// How long a glance stays after the pointer leaves its pin, shape or itself.
const GLANCE_LINGER_MS = 250;
// The section an Event's row is in, if any.
const holdingOf = (sections: Sections, id: string | undefined) => (id ? SECTIONS.find(({ key }) => sections[key].some((e) => e.id === id))?.key : undefined);
const SECTIONS: { key: SectionKey; aside: "until" | "distance" | "starts"; empty: "emptyInYourWay" | "emptyAroundYou" | "emptyComingUp" }[] = [
  { key: "inYourWay", aside: "until", empty: "emptyInYourWay" },
  { key: "aroundYou", aside: "distance", empty: "emptyAroundYou" },
  { key: "comingUp", aside: "starts", empty: "emptyComingUp" },
];

interface SectionListProps {
  sections: Sections;
  point: LatLon | undefined;
  selectedId: string | undefined;
  timeZone: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onHighlight: (id: string | undefined) => void;
  onShowOnMap: (id: string) => void;
}

// Around's sections, each a heading with its count that opens to its rows: In your way, Around you, Coming up. The
// first with anything is open; the one holding an Event chosen on the map opens, with that Event's card. Within a
// section, what changes plans comes first; the rest is quiet, there for anyone who looks.
function SectionList({ sections, point, selectedId, timeZone, onSelect, onClose, onHighlight, onShowOnMap }: SectionListProps) {
  const { t, i18n } = useTranslation();
  const [toggled, setToggled] = useState<Partial<Record<SectionKey, boolean>>>({});
  const first = SECTIONS.find(({ key }) => sections[key].length)?.key;
  const holding = holdingOf(sections, selectedId);
  const isOpen = (key: SectionKey) => key === holding || (toggled[key] ?? key === first);
  const distances = useMemo(() => {
    const found = new Map<string, number>();
    const all = [...sections.inYourWay, ...sections.aroundYou, ...sections.comingUp];
    if (point) for (const pin of nearestFirst(all, point)) if (!found.has(pin.event.id)) found.set(pin.event.id, pin.distanceM);
    return found;
  }, [sections, point]);
  const now = new Date();

  const asideOf = (event: Event, aside: (typeof SECTIONS)[number]["aside"]): ReactNode => {
    if (aside === "distance") {
      const far = distances.get(event.id);
      return far === undefined ? undefined : <AsideValue value={{ key: "rowUntil", value: distance(far, i18n.language) }} caption={t("rowAway")} />;
    }
    const value = aside === "until" ? untilOf(event, timeZone, now) : startsOf(event, timeZone, now);
    return <AsideValue value={value} caption={t(aside === "until" ? "rowUntil" : "rowStarts")} />;
  };

  return (
    <div className="around-sections">
      {SECTIONS.filter(({ key }) => sections[key].length).map(({ key, aside }) => {
        const events = [...sections[key]].sort((a, b) => Number(b.decision === "change_plans") - Number(a.decision === "change_plans"));
        const open = isOpen(key);
        return (
          <Accordion
            key={key}
            className="around-section"
            open={open}
            onToggle={() => {
              setToggled({ ...toggled, [key]: !open });
              if (open && key === holding) onClose();
            }}
            header={
              <>
                <span className="around-section-label">{t(key)}</span>{" "}
                <span className="around-section-count">
                  {events.length}
                </span>
              </>
            }
          >
            <ul aria-label={t(key)} className="around-rows">
                {events.map((event) => (
                  <li key={event.id}>
                    <EventRow
                      event={event}
                      open={event.id === selectedId}
                      onToggle={() => (event.id === selectedId ? onClose() : onSelect(event.id))}
                      aside={asideOf(event, aside)}
                      onHighlight={onHighlight}
                      onShowOnMap={() => onShowOnMap(event.id)}
                    />
                  </li>
                ))}
            </ul>
          </Accordion>
        );
      })}
      {/* What's empty, in one quiet line rather than a heading each. */}
      {SECTIONS.some(({ key }) => !sections[key].length) && (
        <p className="around-empty">
          {SECTIONS.filter(({ key }) => !sections[key].length)
            .map(({ empty }) => t(empty))
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

// "until" over "1.4.2027", "starts" over "Tomorrow"; just "No end date" when there's none.
function AsideValue({ value, caption }: { value: RowValue; caption: string }) {
  const { t } = useTranslation();
  if (value.key === "rowNoEnd") return <span className="sg-aside-caption">{t("rowNoEnd")}</span>;
  return (
    <>
      <span className="sg-aside-caption">{caption}</span>
      <span className="sg-aside-value">{value.key === "rowUntil" ? value.value : t(value.key, value)}</span>
    </>
  );
}
