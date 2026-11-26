import type { Schema } from "@pulse/client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { crowdText } from "./rowWords.ts";
import { Accordion, EventRow } from "./EventRows.tsx";
import type { Pin } from "./events.ts";
import type { LatLon } from "./platform.tsx";
import { HeadsUp, Itineraries, LegChips, ParkingNear, type ParkingPick, TravelModes } from "./TripPanel.tsx";
import { arrivalOf, itineraryOf, mapsLinks, onApple, parkingWalkMin, type Step, type Way } from "./trips.ts";
import { WaySteps } from "./WaySteps.tsx";

// A Trip's result (design round 2026-11-25): one recommendation, said as when to leave, how long, and why only when
// it isn't the obvious way; a link to a navigation app. What's on the way is behind its accordion, the other ways
// and modes behind theirs.

type Trip = Schema<"Trip">;

export interface TripResultProps {
  trip: Trip;
  best: Way | undefined;
  shown: Way | undefined;
  // What the best way avoids on the fastest, when it isn't the fastest.
  avoids: string | undefined;
  from: LatLon;
  to: LatLon;
  toName: string;
  // The way shown, step by step; a step tapped is shown on the map.
  steps: Step[];
  onStep: (at: LatLon) => void;
  onTrip: Pin[];
  selectedId: string | undefined;
  timeZone: string;
  titleOf: (id: string) => string | undefined;
  parking: Trip["parking"] | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
  onHighlight: (id: string | undefined) => void;
  onWay: (way: Partial<Way> | undefined) => void;
  onPick: (pick: ParkingPick) => void;
}

export function TripResult(props: TripResultProps) {
  const { trip, best, shown, avoids, from, to, toName, onTrip, selectedId, timeZone, titleOf, parking, onWay } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen({ ...open, [key]: !open[key] });
  const itinerary = itineraryOf(trip, shown);
  const isBest = !!best && !!shown && best.mode === shown.mode && best.index === shown.index;
  const plan = shown && trip.plans.find((p) => p.mode === shown.mode);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  // The other ways hold the one shown when it was chosen there: open, so the choice is in sight.
  const othersOpen = open.others ?? !isBest;

  const others = (
    <Accordion className="trip-more" open={othersOpen} onToggle={() => setOpen({ ...open, others: !othersOpen })} header={<span className="trip-more-label">{t("tripOtherWays")}</span>}>
      <div className="trip-others">
        <TravelModes trip={trip} mode={shown?.mode ?? "transit"} shownIndex={(m) => (m === shown?.mode ? shown.index : best?.mode === m ? best.index : 0)} onMode={(mode) => onWay({ mode })} />
        {plan && (
          <Itineraries
            itineraries={plan.itineraries}
            titleOf={titleOf}
            chosen={shown?.index ?? 0}
            {...(trip.recommended?.mode === plan.mode ? { better: { index: trip.recommended.index, ...(avoids ? { avoids } : {}) } } : {})}
            timeZone={timeZone}
            onChoose={(index) => onWay({ mode: plan.mode, index })}
          />
        )}
      </div>
    </Accordion>
  );

  if (!itinerary || !shown) {
    return (
      <div className="trip">
        <p className="trip-none">{t("tripNoWay")}</p>
        {others}
      </div>
    );
  }

  const walk = parkingWalkMin(trip, shown.mode, itinerary);
  const arrival = arrivalOf(trip, shown.mode, itinerary);
  const minutes = Math.round((arrival - Date.parse(itinerary.start)) / 60_000);
  const freeFlow = shown.mode === "car" && itinerary.legs.every((leg) => leg.mode === "car" || leg.mode === "walk");
  const driveMinutes = Math.round((Date.parse(itinerary.end) - Date.parse(itinerary.start)) / 60_000);
  const howLong = !freeFlow
    ? t("minutes", { count: minutes })
    : walk
      ? t("tripDriveAndWalk", { drive: driveMinutes, walk })
      : `~${t("minutes", { count: minutes })}, ${t("tripNoTraffic")}`;
  const plainDrive = trip.plans.find((p) => p.mode === "car")?.itineraries[0];
  const links = mapsLinks({ from, to, way: shown, itinerary, plainDrive, parking: parking?.picks[0], apple: onApple(navigator.userAgent) });
  const wholeWayFirst = [...onTrip].sort((a, b) => Number(!!b.trip?.wholeWay) - Number(!!a.trip?.wholeWay));

  return (
    <div className="trip">
      <section aria-label={t(isBest ? "tripBest" : "tripChosen")} className="trip-way">
        <p className="trip-label">
          {t(isBest ? "tripBest" : "tripChosen")} · {t(`mode_${shown.mode}`)}
        </p>
        <p className="trip-leave">{t("tripLeave", { time: clock.format(new Date(itinerary.start)) })}</p>
        <p className="trip-arrive">
          {t("tripArrive", { time: clock.format(new Date(arrival)) })} · {howLong}
        </p>
        <div className="trip-legs">
          <LegChips legs={itinerary.legs} />
        </div>
        {isBest && avoids && <p className="trip-reason">{t("tripAvoids", { what: avoids })}</p>}
        {!isBest && (
          <button type="button" className="trip-back" onClick={() => onWay(undefined)}>
            ‹ {t("tripBackToBest")}
          </button>
        )}
        <div className="trip-open">
          <a href={links.google} target="_blank" rel="noreferrer" className="trip-open-main">
            {t("openGoogle")} ↗
          </a>
          {links.apple && (
            <a href={links.apple} target="_blank" rel="noreferrer" className="trip-open-alt">
              {t("openApple")} ↗
            </a>
          )}
        </div>
        {links.apple && links.steered && <p className="trip-note">{t("tripAppleNoDetour")}</p>}
      </section>

      {props.steps.length > 0 && (
        <Accordion className="trip-more" open={!!open.steps} onToggle={() => toggle("steps")} header={<span className="trip-more-label">{t("tripSteps")}</span>}>
          <WaySteps steps={props.steps} timeZone={timeZone} onStep={props.onStep} />
        </Accordion>
      )}

      {onTrip.length > 0 && (
        <Accordion
          className="trip-more"
          open={!!open.way || onTrip.some((p) => p.event.id === selectedId)}
          onToggle={() => toggle("way")}
          header={
            <>
              <span className="trip-more-label">{t("onTheWay")}</span>{" "}
              <span className="around-section-count">{onTrip.length}</span>
            </>
          }
        >
          <ul aria-label={t("onTheWay")} className="around-rows">
            {wholeWayFirst.map(({ event, trip: at }) => (
              <li key={event.id}>
                <EventRow
                  event={event}
                  open={event.id === selectedId}
                  onToggle={() => (event.id === selectedId ? props.onClose() : props.onSelect(event.id))}
                  aside={
                    <span className="sg-aside-value">
                      {at?.crowd ? crowdText(at.crowd, timeZone, t) : at?.wholeWay ? t("wholeWay") : at?.minutes ? t("atMinute", { count: at.minutes }) : t("atStart")}
                    </span>
                  }
                  onHighlight={props.onHighlight}
                />
              </li>
            ))}
          </ul>
        </Accordion>
      )}

      <HeadsUp comingUp={itinerary.comingUp} titleOf={titleOf} legs={itinerary.legs} timeZone={timeZone} />

      {parking && (
        <Accordion className="trip-more" open={!!open.parking} onToggle={() => toggle("parking")} header={<span className="trip-more-label">{t("parkingNear", { place: toName })}</span>}>
          <ParkingNear parking={parking} place={toName} onPick={props.onPick} untitled />
        </Accordion>
      )}

      {others}
    </div>
  );
}
