import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Pin } from "../events.ts";
import type { LatLon } from "../platform.tsx";
import { PEEK_PX } from "../Sheet.tsx";
import { longPress } from "./long-press.ts";

// OpenFreeMap: free vector tiles, no key. Positron is muted, so Events drawn on top stand out.
const STYLE = "https://tiles.openfreemap.org/styles/positron";
const ZOOM = 15;
// How far below the middle a pin with an open card sits, so the card above it is in view.
const POPUP_ROOM_PX = 120;

export interface PointMapProps {
  // The point the app is looking around; the map centres on it and marks it.
  point: LatLon | undefined;
  // A press that rests on the map (touch), or a right-click (mouse): choose that place.
  onLongPress: (at: LatLon) => void;
  // The person dragged the map, e.g. to look elsewhere while following.
  onPan: () => void;
  // A tap on the map itself, not on a pin or the popup.
  onMapClick: () => void;
  // What to draw on the map, in tab order (nearest first), and how each one looks.
  pins: Pin[];
  renderPin: (pin: Pin) => ReactNode;
  // A card popping up from one of the pins.
  popup?: { pinKey: string; content: ReactNode };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PointMap({ point, onLongPress, onPan, onMapClick, pins, renderPin, popup }: PointMapProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  // One MapLibre marker per pin, by key; React renders each pin into its marker's element.
  const pinMarkers = useRef(new Map<string, maplibregl.Marker>());
  const [slots, setSlots] = useState<{ pin: Pin; element: HTMLElement }[]>([]);
  // The map's handlers are bound once; they read the latest callbacks from here.
  const onLongPressRef = useRef(onLongPress);
  const onPanRef = useRef(onPan);
  const onMapClickRef = useRef(onMapClick);
  const pinsRef = useRef(pins);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
    onPanRef.current = onPan;
    onMapClickRef.current = onMapClick;
    pinsRef.current = pins;
  }, [onLongPress, onPan, onMapClick, pins]);
  const mapPopup = useRef<maplibregl.Popup | null>(null);
  const [popupElement] = useState(() => document.createElement("div"));

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({ container: container.current, style: STYLE, zoom: ZOOM, center: [0, 0], attributionControl: { compact: true } });
    // The bottom sheet covers the bottom of the map: centre the point in the part that shows.
    m.setPadding({ top: 0, right: 0, left: 0, bottom: PEEK_PX });
    const choose = ({ lat, lng }: maplibregl.LngLat) => onLongPressRef.current({ lat, lon: lng });
    const press = longPress({ onLongPress: ({ x, y }) => choose(m.unproject([x, y])) });

    // Pins and the popup sit inside the map's container, so their taps reach the map too: those aren't the map's.
    const onOverlay = (e: { originalEvent: Event }) =>
      e.originalEvent.target instanceof Element && e.originalEvent.target.closest(".maplibregl-marker, .maplibregl-popup") !== null;

    m.on("touchstart", (e) => (e.points.length === 1 && !onOverlay(e) ? press.down(e.point) : press.cancel()));
    m.on("touchmove", (e) => press.move(e.point));
    m.on("touchend", press.up);
    m.on("touchcancel", press.cancel);
    m.on("dragstart", () => {
      press.cancel();
      onPanRef.current();
    });
    // Mouse: right-click. Touch browsers also fire contextmenu on a long press; the detector above handles those.
    m.on("click", (e) => {
      if (!onOverlay(e)) onMapClickRef.current();
    });
    m.on("contextmenu", (e) => {
      if (onOverlay(e) || (e.originalEvent instanceof PointerEvent && e.originalEvent.pointerType === "touch")) return;
      choose(e.lngLat);
    });

    map.current = m;
    return () => {
      press.cancel();
      m.remove();
      map.current = null;
      marker.current = null;
      mapPopup.current = null;
      pinMarkers.current.clear();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const markers = pinMarkers.current;
    const wanted = new Set(pins.map((p) => p.key));
    for (const [key, old] of markers) {
      if (!wanted.has(key)) {
        old.remove();
        markers.delete(key);
      }
    }
    const next = pins.map((pin) => {
      let pinMarker = markers.get(pin.key);
      if (!pinMarker) {
        pinMarker = new maplibregl.Marker({ element: document.createElement("div") }).setLngLat(pin.lngLat).addTo(m);
        markers.set(pin.key, pinMarker);
      } else {
        pinMarker.setLngLat(pin.lngLat);
      }
      const element = pinMarker.getElement();
      // Markers sit in the DOM in the order they were added; re-appending keeps the tab order nearest first.
      element.parentElement?.appendChild(element);
      return { pin, element };
    });
    setSlots(next);
  }, [pins]);

  // The popup follows its pin; the map pans so the pin sits low enough for the card to fit above it.
  const popupKey = popup?.pinKey;
  useEffect(() => {
    const m = map.current;
    if (!m || !popupKey) return;
    const pin = pinsRef.current.find((p) => p.key === popupKey);
    if (!pin) return;
    if (!mapPopup.current) {
      mapPopup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 24, maxWidth: "none" })
        .setDOMContent(popupElement)
        .addTo(m);
    }
    mapPopup.current.setLngLat(pin.lngLat);
    m.easeTo({ center: pin.lngLat, offset: [0, POPUP_ROOM_PX], duration: reducedMotion() ? 0 : 400 });
    return () => {
      mapPopup.current?.remove();
      mapPopup.current = null;
    };
  }, [popupKey, popupElement]);

  const lat = point?.lat;
  const lon = point?.lon;
  useEffect(() => {
    const m = map.current;
    if (!m || lat === undefined || lon === undefined) return;
    if (!marker.current) {
      // First known point: jump there instead of flying from the middle of the ocean.
      marker.current = new maplibregl.Marker().setLngLat([lon, lat]).addTo(m);
      m.jumpTo({ center: [lon, lat] });
      return;
    }
    marker.current.setLngLat([lon, lat]);
    m.easeTo({ center: [lon, lat], duration: reducedMotion() ? 0 : 500 });
  }, [lat, lon]);

  // MapLibre's stylesheet makes its container `position: relative`, and unlayered CSS beats Tailwind's layered
  // utilities: so the map gets an inner element and the wrapper does the positioning.
  // The attribution (required by the OpenStreetMap licence) sits just above the sheet's peek, not under it.
  // The popup's own frame is replaced by the card's (`!`: MapLibre's unlayered CSS beats Tailwind otherwise).
  return (
    <div
      className="absolute inset-0 [&_.maplibregl-ctrl-bottom-right]:mb-38 [&_.maplibregl-popup-content]:rounded-xl! [&_.maplibregl-popup-content]:p-0! [&_.maplibregl-popup-content]:shadow-xl!"
      role="region"
      aria-label={t("map")}
    >
      <div ref={container} className="h-full w-full" />
      {slots.map(({ pin, element }) => createPortal(renderPin(pin), element, pin.key))}
      {popup && createPortal(popup.content, popupElement)}
    </div>
  );
}
