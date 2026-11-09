import type { GeocodeResult, TravelMode } from "@pulse/client";
import { CircleCheck, LoaderCircle, LocateFixed, LocateIcon, Navigation, Route } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddressSearch } from "./AddressSearch.tsx";
import { RADIUS_M, useEvents, useRegions, useTrip } from "./api.ts";
import { CARD_VARIANT_NAMES, CARD_VARIANTS, PrototypeEventCard as EventCard } from "./EventCard.prototype.tsx";
import { PrototypeSwitcher } from "./PrototypeSwitcher.tsx";
import { EventList } from "./EventList.tsx";
import { inMyArea, nearestFirst, regionWide, statusOf, textIn, type Time, tripPins } from "./events.ts";
import { EventPin, PinGroup } from "./map/EventPin.tsx";
import { Legend, RegionWide } from "./MapOverlays.tsx";
import { PointMap } from "./map/PointMap.tsx";
import { type LatLon, LocationError, usePlatform } from "./platform.tsx";
import { formatAt, parseAt, usePoint } from "./point.ts";
import { PANEL_PX, PEEK_PX, Sheet } from "./Sheet.tsx";
import { HeadsUp, Itineraries, OnTheWay, ParkingNear, parkingDetails, TravelModes, TripForm } from "./TripPanel.tsx";

// The locate button, as in map apps: the first tap goes to my location, the second follows it, the third stops.
// Panning the map or choosing a place by hand also stops following.
type Locate = "off" | "centred" | "following";

const PANEL_HIDDEN_KEY = "panelHidden";

// The one screen: the map with its status chip and the pins' cards, and the sheet with the controls.
export function Home() {
  const { t } = useTranslation();
  const { location, storage } = usePlatform();
  const { point, setPoint } = usePoint();
  const regions = useRegions();
  const search = useSearch({ from: "/" });
  const { event: selectedId, mode = "transit" } = search;
  // The time switch opens on Now where the app may know where you are, else on the next two weeks: "right now"
  // somewhere you aren't means little. A time in the URL wins.
  const [locationAllowed, setLocationAllowed] = useState(false);
  useEffect(() => {
    void location.allowed().then(setLocationAllowed);
  }, [location]);
  const time: Time = search.time ?? (locationAllowed ? "now" : "14d");
  const navigate = useNavigate({ from: "/" });
  const events = useEvents(point, time);
  // Only what gets in the way, or may: worth considering or major, and in somebody's way (a sea warning isn't).
  // Minor and info are the place's normal.
  const shown = useMemo(
    () => events.data?.filter((e) => (e.severity === "consider" || e.severity === "major") && e.mainlyAffected !== "nobody" && inMyArea(e)),
    [events.data],
  );
  const ordinary = shown !== undefined && shown.length < (events.data?.length ?? 0);
  // Trip mode: from the point unless From was changed.
  const tripFrom = parseAt(search.from) ?? point;
  const tripTo = parseAt(search.to);
  const trip = useTrip(search.trip ? tripFrom : undefined, search.trip ? tripTo : undefined);
  const [locate, setLocate] = useState<Locate>("off");
  const [peekPx, setPeekPx] = useState(PEEK_PX);
  // The docked panel slid away, as it was last time on this device.
  const [panelHidden, setPanelHidden] = useState(false);
  useEffect(() => {
    void storage.get(PANEL_HIDDEN_KEY).then((value) => setPanelHidden(value === "true"));
  }, [storage]);
  const hidePanel = (hidden: boolean) => {
    setPanelHidden(hidden);
    void storage.set(PANEL_HIDDEN_KEY, String(hidden));
  };
  const [locating, setLocating] = useState(false);
  const [failure, setFailure] = useState<LocationError["reason"] | null>(null);

  // The watch is started once per "following"; it reads the latest setPoint from here.
  const setPointRef = useRef(setPoint);
  useEffect(() => {
    setPointRef.current = setPoint;
  }, [setPoint]);

  useEffect(() => {
    if (locate !== "following") return;
    return location.watch(
      (fix) => setPointRef.current(fix),
      (error) => {
        setFailure(error.reason);
        setLocate("off");
      },
    );
  }, [locate, location]);

  const onLocate = async () => {
    setFailure(null);
    if (locate === "centred") return setLocate("following");
    if (locate === "following") return setLocate("off");
    setLocating(true);
    try {
      setPoint(await location.current());
      setLocate("centred");
    } catch (error) {
      setFailure(error instanceof LocationError ? error.reason : "unavailable");
    } finally {
      setLocating(false);
    }
  };

  const choosePlace = (at: LatLon) => {
    setLocate("off");
    setPoint(at);
  };

  // Opening Trip mode is a step Back undoes; what's chosen inside it isn't.
  const openTrip = () => void navigate({ search: (prev) => ({ ...prev, trip: true }) });
  const closeTrip = () =>
    void navigate({
      search: (prev) => ({ ...prev, trip: undefined, to: undefined, toName: undefined, from: undefined, fromName: undefined, mode: undefined }),
      replace: true,
    });
  const setTripEnd = (end: "from" | "to") => (place: GeocodeResult) =>
    void navigate({ search: (prev) => ({ ...prev, [end]: formatAt(place), [`${end}Name`]: place.name }), replace: true });
  const setTime = (next: Time) => void navigate({ search: (prev) => ({ ...prev, time: next }), replace: true });
  const select = (id: string) => void navigate({ search: (prev) => ({ ...prev, event: id }) });
  // Closing the card hands focus back to the pin it came from.
  const closeCard = () => {
    if (!selectedId) return;
    void navigate({ search: (prev) => ({ ...prev, event: undefined }) }).then(() =>
      document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(selectedId)}"]`)?.focus(),
    );
  };

  // The reader's languages for Event texts: the browser's, then the Region's.
  const languages = useMemo(
    () => [...navigator.languages.map((l) => l.split("-")[0]!), ...(regions.data?.[0]?.languages ?? [])],
    [regions.data],
  );
  // In Trip mode the map shows the chosen itinerary and only the Events on it: the one picked, else the one that's
  // better today, else the first.
  const recommended = trip.data?.recommended;
  const shownIndex = (m: TravelMode) => (m === mode && search.route !== undefined ? search.route : recommended?.mode === m ? recommended.index : 0);
  const plan = search.trip ? trip.data?.plans.find((p) => p.mode === mode) : undefined;
  const itinerary = plan ? (plan.itineraries[shownIndex(mode)] ?? plan.itineraries[0]) : undefined;
  // What the better way avoids: the worst of what's in the fastest way's way and not in its own.
  const avoids = (() => {
    if (!trip.data || !recommended) return undefined;
    const ways = trip.data.plans.flatMap((p) => p.itineraries);
    const fastest = ways.reduce<(typeof ways)[number] | undefined>((a, b) => (!a || Date.parse(b.end) < Date.parse(a.end) ? b : a), undefined);
    const better = trip.data.plans.find((p) => p.mode === recommended.mode)?.itineraries[recommended.index];
    // Only what's in the way counts: worth considering or major on that way.
    const inWay = (way: typeof fastest) => new Set(way?.onTheWay.filter((m) => m.impact === "consider" || m.impact === "major").map((m) => m.eventId));
    const [onFastest, onBetter] = [inWay(fastest), inWay(better)];
    const avoided = trip.data.events.filter((e) => onFastest.has(e.id) && !onBetter.has(e.id));
    const rank = { info: 0, minor: 1, consider: 2, major: 3 };
    const worst = avoided.sort((a, b) => rank[b.severity] - rank[a.severity])[0];
    return worst && textIn(worst.title, languages);
  })();
  // On a Trip, what's in the way, pinned where the trip meets it.
  const onTrip = useMemo(
    () => (search.trip ? tripPins(itinerary?.onTheWay ?? [], trip.data?.events ?? []) : undefined),
    [search.trip, itinerary, trip.data],
  );
  const around = useMemo(() => (!search.trip && point && shown ? nearestFirst(shown, point) : []), [search.trip, point, shown]);
  const pins = onTrip ?? around;
  const selectedPin = pins.find((p) => p.event.id === selectedId);
  const selected = selectedPin?.event;
  // What's region-wide has no pin: its card opens under the chip instead.
  const notices = useMemo(() => (!search.trip && shown ? regionWide(shown) : []), [search.trip, shown]);
  const selectedNotice = selectedPin ? undefined : notices.find((e) => e.id === selectedId);
  const titleOf = (id: string) => {
    const event = trip.data?.events.find((e) => e.id === id);
    return event && textIn(event.title, languages);
  };
  // Parking at B is for driving there (walking the last bit, maybe): a park-and-ride way parks on the way.
  const parking = mode === "car" && itinerary?.legs.every((leg) => leg.mode === "car" || leg.mode === "walk") ? trip.data?.parking : undefined;
  const parkingOnMap = useMemo(
    () => parking && { picks: parking.picks, places: (parking.street?.places ?? []).map((place) => ({ ...place, label: parkingDetails(place, t) })) },
    [parking, t],
  );
  // A parking pick chosen in the panel, to zoom the map to: a new key each time, so the same one zooms again.
  const [focus, setFocus] = useState<LatLon & { key: number }>();
  // An Event pointed at in the panel's list: its shape stands out on the map.
  const [highlighted, setHighlighted] = useState<string>();
  const timeZone = regions.data?.[0]?.timeZone ?? "UTC";

  const status = (() => {
    if (search.trip) {
      if (tripTo && trip.isFetching && !itinerary) return { text: t("findingRoutes"), clear: false };
      if (!itinerary) return null;
      const count = onTrip?.length ?? 0;
      return count ? { text: t("statusTrip", { count }), clear: false } : { text: t("statusTripClear"), clear: true };
    }
    if (events.isError) return { text: t("statusError"), clear: false };
    if (!shown) return null;
    const s = statusOf(shown, time);
    if (!("count" in s)) return { text: t(ordinary ? (time === "now" ? "statusOrdinaryNow" : "statusOrdinarySoon") : s.key), clear: true };
    const counted = t(s.key, { count: s.count });
    return { text: s.major ? t("statusMajor", { status: counted, major: s.major }) : counted, clear: false };
  })();

  const label = { off: t("goToMyLocation"), centred: t("followMyLocation"), following: t("followingYourLocation") }[locate];
  const Icon = { off: LocateIcon, centred: LocateFixed, following: Navigation }[locate];

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <h1 className="sr-only">{t("appName")}</h1>
      {/* The map fills the screen, under the sheet or panel too; it centres in the part that shows. */}
      <div className="absolute inset-0">
        <PointMap
          point={point}
          onLongPress={choosePlace}
          onPan={() => setLocate("off")}
          onMapClick={closeCard}
          pins={pins}
        bottomInset={peekPx}
        leftInset={panelHidden ? 0 : PANEL_PX}
        {...(itinerary ? { route: itinerary.legs } : {})}
        {...(parkingOnMap ? { parking: parkingOnMap } : {})}
        {...(search.trip && tripTo ? { destination: { ...tripTo, name: search.toName ?? t("to") } } : {})}
        {...(focus ? { focus } : {})}
          {...(selected && selectedPin
            ? {
                popup: {
                  pinKey: selectedPin.key,
                  content: <EventCard variant={search.variant} event={selected} languages={languages} timeZone={timeZone} onClose={closeCard} />,
                },
              }
            : {})}
          renderPin={(pin) => (
            <EventPin
              pin={pin}
              languages={languages}
              selected={pin.event.id === selectedId}
              onSelect={() => select(pin.event.id)}
            />
          )}
          renderGroup={(group, zoomIn) => <PinGroup pins={group} languages={languages} zoomIn={zoomIn} onSelect={select} />}
          onShapeClick={select}
          emphasised={[selectedId, highlighted].filter((id): id is string => id !== undefined)}
          {...(!search.trip ? { radiusM: RADIUS_M } : {})}
        />
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))] lg:motion-safe:transition-[left] lg:motion-safe:duration-300 ${panelHidden ? "" : "lg:left-90"}`}
        >
          <p role="status" className={`flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-sm font-medium shadow ${status ? "" : "invisible"}`}>
            {status?.clear && <CircleCheck aria-hidden className="size-4 text-emerald-600" />}
            {status?.text}
          </p>
          <RegionWide
            events={notices}
            selectedId={selectedId}
            languages={languages}
            timeZone={timeZone}
            onSelect={select}
            card={selectedNotice ? <EventCard variant={search.variant} event={selectedNotice} languages={languages} timeZone={timeZone} onClose={closeCard} /> : null}
          />
          {regions.isError && (
            <p role="alert" className="pointer-events-auto rounded-md bg-background px-3 py-2 text-sm shadow">
              {t("regionsFailed")}
            </p>
          )}
          {failure && (
            <p role="alert" className="pointer-events-auto max-w-sm rounded-md bg-background px-3 py-2 text-sm shadow">
              {t(failure === "denied" ? "locationDenied" : "locationUnavailable")}
            </p>
          )}
        </div>
        <div className="pointer-events-none absolute top-0 right-0 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <Legend radiusM={search.trip ? undefined : RADIUS_M} />
        </div>
      </div>
      <Sheet
        title={t("sheetTitle")}
        onPeekHeight={setPeekPx}
        hidden={panelHidden}
        onHiddenChange={hidePanel}
        top={
          search.trip ? (
            <TripForm
              point={point}
              lang={languages[0] ?? "en"}
              fromName={search.fromName}
              toName={search.toName}
              onFrom={setTripEnd("from")}
              onTo={setTripEnd("to")}
              onClose={closeTrip}
            />
          ) : (
            <div className="flex items-center gap-2">
              <AddressSearch point={point} lang={languages[0] ?? "en"} onPick={choosePlace} />
              <Button variant="secondary" size="icon" className="size-11 shrink-0" aria-label={t("route")} onClick={openTrip}>
                <Route aria-hidden />
              </Button>
            </div>
          )
        }
        peek={
          search.trip ? (
            tripTo ? (
              trip.isError ? (
                <p role="alert" className="flex-1 text-sm">
                  {t("tripFailed")}
                </p>
              ) : (
                <TravelModes
                  trip={trip.data}
                  mode={mode}
                  shownIndex={shownIndex}
                  onMode={(next) => void navigate({ search: (prev) => ({ ...prev, mode: next, route: undefined }), replace: true })}
                />
              )
            ) : (
              <div className="flex-1" />
            )
          ) : (
          <>
              <fieldset className="flex rounded-lg bg-muted p-1">
                <legend className="sr-only">{t("time")}</legend>
                {(["now", "14d"] as const).map((option) => (
                  <label
                    key={option}
                    className="grid min-h-9 min-w-20 cursor-pointer place-items-center rounded-md px-3 text-sm font-medium has-checked:bg-background has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
                  >
                    <input type="radio" name="time" className="sr-only" checked={time === option} onChange={() => setTime(option)} />
                    {t(option === "now" ? "timeNow" : "time14d")}
                  </label>
                ))}
              </fieldset>
              <Button
                variant={locate === "following" ? "default" : "secondary"}
                size="icon"
                className="ml-auto size-11"
                aria-label={locating ? t("locating") : label}
                aria-pressed={locate === "following"}
                disabled={locating}
                onClick={onLocate}
              >
                <Icon aria-hidden className={locate === "following" ? "fill-current" : undefined} />
              </Button>
          </>
          )
        }
      >
        {search.trip ? (
          // Finding routes: the map's status line says so too, for screen readers.
          tripTo && trip.isPending ? (
            <p aria-hidden className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              {t("findingRoutes")}
            </p>
          ) : plan && (
            <div className="space-y-4">
              <Itineraries
                itineraries={plan.itineraries}
                titleOf={titleOf}
                chosen={shownIndex(mode)}
                {...(recommended?.mode === mode ? { better: { index: recommended.index, ...(avoids ? { avoids } : {}) } } : {})}
                timeZone={timeZone}
                onChoose={(index) => void navigate({ search: (prev) => ({ ...prev, route: index }), replace: true })}
              />
              {itinerary && (
                <HeadsUp comingUp={itinerary.comingUp} titleOf={titleOf} legs={itinerary.legs} timeZone={timeZone} />
              )}
              {parking && (
                <ParkingNear
                  parking={parking}
                  place={search.toName ?? t("to")}
                  onPick={({ lat, lon }) => setFocus((prev) => ({ lat, lon, key: (prev?.key ?? 0) + 1 }))}
                />
              )}
              {itinerary && onTrip && (
                <OnTheWay legs={itinerary.legs} pins={onTrip} selectedId={selectedId} languages={languages} timeZone={timeZone} onSelect={select} />
              )}
            </div>
          )
        ) : (
          <>
            {/* The list is for the docked panel; on phones the map is the list (they asked for no list in the sheet). */}
            <div className="hidden lg:block">
              <EventList pins={pins} selectedId={selectedId} languages={languages} timeZone={timeZone} onSelect={select} onHighlight={setHighlighted} />
            </div>
            <p className="text-sm text-muted-foreground lg:hidden">{t("sheetHint")}</p>
          </>
        )}
      </Sheet>
      <PrototypeSwitcher variants={CARD_VARIANTS} names={CARD_VARIANT_NAMES} current={search.variant ?? "A"} />
    </main>
  );
}
