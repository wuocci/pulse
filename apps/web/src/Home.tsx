import type { GeocodeResult } from "@pulse/client";
import { CircleCheck, LocateFixed, LocateIcon, Navigation, Route } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddressSearch } from "./AddressSearch.tsx";
import { useEvents, useRegions, useTrip } from "./api.ts";
import { EventCard } from "./EventCard.tsx";
import { EventList } from "./EventList.tsx";
import { nearestFirst, statusOf, type Time } from "./events.ts";
import { EventPin } from "./map/EventPin.tsx";
import { PointMap } from "./map/PointMap.tsx";
import { type LatLon, LocationError, usePlatform } from "./platform.tsx";
import { formatAt, parseAt, usePoint } from "./point.ts";
import { Sheet } from "./Sheet.tsx";
import { TravelModes, TripForm } from "./TripPanel.tsx";

// The locate button, as in map apps: the first tap goes to my location, the second follows it, the third stops.
// Panning the map or choosing a place by hand also stops following.
type Locate = "off" | "centred" | "following";

// The one screen: the map with its status chip and the pins' cards, and the sheet with the controls.
export function Home() {
  const { t } = useTranslation();
  const { location } = usePlatform();
  const { point, setPoint } = usePoint();
  const regions = useRegions();
  const search = useSearch({ from: "/" });
  const { time = "now", event: selectedId, mode = "transit" } = search;
  const navigate = useNavigate({ from: "/" });
  const events = useEvents(point, time);
  // Trip mode: from the point unless From was changed.
  const tripFrom = parseAt(search.from) ?? point;
  const tripTo = parseAt(search.to);
  const trip = useTrip(search.trip ? tripFrom : undefined, search.trip ? tripTo : undefined);
  const [locate, setLocate] = useState<Locate>("off");
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
  const pins = useMemo(() => (point && events.data ? nearestFirst(events.data, point) : []), [events.data, point]);
  const selected = events.data?.find((e) => e.id === selectedId);
  // The card pops up from the selected Event's nearest pin.
  const selectedPin = selected ? pins.find((p) => p.event.id === selected.id) : undefined;
  const timeZone = regions.data?.[0]?.timeZone ?? "UTC";

  const status = (() => {
    if (events.isError) return { text: t("statusError"), clear: false };
    if (!events.data) return null;
    const s = statusOf(events.data, time);
    if (!("count" in s)) return { text: t(s.key), clear: true };
    const counted = t(s.key, { count: s.count });
    return { text: s.major ? t("statusMajor", { status: counted, major: s.major }) : counted, clear: false };
  })();

  const label = { off: t("goToMyLocation"), centred: t("followMyLocation"), following: t("followingYourLocation") }[locate];
  const Icon = { off: LocateIcon, centred: LocateFixed, following: Navigation }[locate];

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <h1 className="sr-only">{t("appName")}</h1>
      {/* The map fills the screen; on wide screens it starts where the docked panel ends. */}
      <div className="absolute inset-0 lg:left-90">
        <PointMap
          point={point}
          onLongPress={choosePlace}
          onPan={() => setLocate("off")}
          onMapClick={closeCard}
          pins={pins}
          {...(selected && selectedPin
            ? {
                popup: {
                  pinKey: selectedPin.key,
                  content: <EventCard event={selected} languages={languages} timeZone={timeZone} onClose={closeCard} />,
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
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <p role="status" className={`flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-sm font-medium shadow ${status ? "" : "invisible"}`}>
            {status?.clear && <CircleCheck aria-hidden className="size-4 text-emerald-600" />}
            {status?.text}
          </p>
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
      </div>
      <Sheet
        title={t("sheetTitle")}
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
                <TravelModes trip={trip.data} mode={mode} onMode={(next) => void navigate({ search: (prev) => ({ ...prev, mode: next }), replace: true })} />
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
        {/* The list is for the docked panel; on phones the map is the list (they asked for no list in the sheet). */}
        <div className="hidden lg:block">
          <EventList pins={pins} selectedId={selectedId} languages={languages} timeZone={timeZone} onSelect={select} />
        </div>
        <p className="text-sm text-muted-foreground lg:hidden">{t("sheetHint")}</p>
      </Sheet>
    </main>
  );
}
