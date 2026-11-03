import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Schema } from "@pulse/client";
import { circleAround, groupNear, outlineOf, type Pin, sameSpot, type Tone, toneOf } from "../events.ts";
import type { LatLon } from "../platform.tsx";
import { DOCKED_MEDIA, PANEL_PX, PEEK_PX } from "../Sheet.tsx";
import { LEG_STYLE } from "../transit.ts";
import { longPress } from "./long-press.ts";

// OpenFreeMap: free vector tiles, no key. Positron is muted, so Events drawn on top stand out.
const STYLE = "https://tiles.openfreemap.org/styles/positron";
const ZOOM = 15;
// How far below the middle a pin with an open card sits, so the card above it is in view.
const POPUP_ROOM_PX = 120;
// Pins closer than this on screen are drawn as one group.
const GROUP_PX = 36;
const OUTLINE_LAYERS = ["outline-lines", "outline-areas"];
// An Event's area or line, under its pin, in its pin's colour.
const TONE_COLOURS: Record<Tone, string> = { quiet: "#737373", consider: "#d97706", major: "#dc2626" };

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
  // Pins that overlap at this zoom, drawn as one (nearest first); `zoomIn` is absent when they're at one spot.
  // Without it, every pin is drawn.
  renderGroup?: (pins: Pin[], zoomIn: (() => void) | undefined) => ReactNode;
  // How far the map looks around the point, as a faint circle; none when absent.
  radiusM?: number;
  // A tap on an Event's area or line: the same as tapping its pin.
  onShapeClick?: (eventId: string) => void;
  // Events whose areas and lines stand out: the one selected, and one pointed at in the list.
  emphasised?: string[];
  // A card popping up from one of the pins.
  popup?: { pinKey: string; content: ReactNode };
  // A Trip's route, leg by leg: each ride in its mode's colour with its line at the boarding point, walks dotted;
  // fitted into view.
  route?: { mode: Schema<"LegMode">; line?: { name: string }; to?: { parking?: string }; geometry: { coordinates: number[][] } }[];
  // A Trip's destination, marked with its name.
  destination?: LatLon & { name: string };
  // Parking at B: the picks, numbered as in the panel, and every street parking spot around as a small dot that
  // tells, when tapped, what it offers (`label`).
  parking?: { picks: { lat: number; lon: number }[]; places: { lat: number; lon: number; kind: "paid" | "free" | "other"; label: string }[] };
  // A place to zoom in on, e.g. a parking pick chosen in the panel; a new `key` zooms again.
  focus?: LatLon & { key: number };
  // How much of the map the sheet covers: its bottom on phones, its left side when docked as a panel (0 while the
  // panel is hidden). The map centres in the rest.
  bottomInset?: number;
  leftInset?: number;
}

// What one marker on the map holds: a pin, or a group of pins that overlap.
type Slot =
  | { kind: "pin"; key: string; pin: Pin; element: HTMLElement }
  | { kind: "group"; key: string; pins: Pin[]; zoomIn: (() => void) | undefined; element: HTMLElement };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ROUTE_ROOM_PX = 48;

export function PointMap({
  point,
  onLongPress,
  onPan,
  onMapClick,
  pins,
  renderPin,
  renderGroup,
  radiusM,
  onShapeClick,
  emphasised = [],
  popup,
  route,
  destination,
  parking,
  focus,
  bottomInset = PEEK_PX,
  leftInset = PANEL_PX,
}: PointMapProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  // One MapLibre marker per pin, by key; React renders each pin into its marker's element.
  const pinMarkers = useRef(new Map<string, maplibregl.Marker>());
  const [slots, setSlots] = useState<Slot[]>([]);
  // Grouping depends on how far apart pins are on screen: it's redone when the zoom changes.
  const [zoom, setZoom] = useState(ZOOM);
  // The map's handlers are bound once; they read the latest callbacks from here.
  const onLongPressRef = useRef(onLongPress);
  const onPanRef = useRef(onPan);
  const onMapClickRef = useRef(onMapClick);
  const onShapeClickRef = useRef(onShapeClick);
  const pinsRef = useRef(pins);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
    onPanRef.current = onPan;
    onMapClickRef.current = onMapClick;
    onShapeClickRef.current = onShapeClick;
    pinsRef.current = pins;
  }, [onLongPress, onPan, onMapClick, pins]);
  const mapPopup = useRef<maplibregl.Popup | null>(null);
  const [popupElement] = useState(() => document.createElement("div"));

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({ container: container.current, style: STYLE, zoom: ZOOM, center: [0, 0], attributionControl: { compact: true } });
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
    // An Event's area or line under the pointer, if any: lines first, they're drawn on top. A few pixels' slack, so
    // a thin line can be hit with a finger.
    const shapeAt = ({ x, y }: maplibregl.Point) => {
      const layers = OUTLINE_LAYERS.filter((id) => m.getLayer(id));
      const id = layers.length ? m.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]], { layers })[0]?.properties.id : undefined;
      return typeof id === "string" ? id : undefined;
    };
    m.on("click", (e) => {
      if (onOverlay(e)) return;
      const id = shapeAt(e.point);
      if (id && onShapeClickRef.current) onShapeClickRef.current(id);
      else onMapClickRef.current();
    });
    let overShape = false;
    m.on("mousemove", (e) => {
      const over = shapeAt(e.point) !== undefined;
      if (over !== overShape) m.getCanvas().style.cursor = over ? "pointer" : "";
      overShape = over;
    });
    m.on("zoomend", () => setZoom(m.getZoom()));
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

  // The sheet covers part of the map: centre in the part that shows. When that part changes (the panel hides, the
  // peek grows) the map stays where it is: the new centre is the place already under it.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const docked = window.matchMedia(DOCKED_MEDIA);
    const pad = () => {
      const next = { top: 0, right: 0, left: docked.matches ? leftInset : 0, bottom: docked.matches ? 0 : bottomInset };
      const { clientWidth: width, clientHeight: height } = m.getContainer();
      const centre = m.unproject([(width + next.left - next.right) / 2, (height + next.top - next.bottom) / 2]);
      m.jumpTo({ center: centre, padding: next });
    };
    pad();
    docked.addEventListener("change", pad);
    return () => docked.removeEventListener("change", pad);
  }, [bottomInset, leftInset]);

  // Redrawn when the parking changes, not on every render.
  const parkingRef = useRef(parking);
  parkingRef.current = parking;
  const parkingKey = parking ? JSON.stringify(parking) : "";
  // Redrawn and refitted when the route itself changes (or where to park), not on every render.
  const routeRef = useRef(route);
  routeRef.current = route;
  const routeKey = route
    ? JSON.stringify(route.map((leg) => [leg.mode, leg.line?.name, leg.geometry.coordinates.length, leg.geometry.coordinates[0]]))
    : "";
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const legs = routeRef.current ?? [];
    const data: maplibregl.GeoJSONSourceSpecification["data"] = {
      type: "FeatureCollection",
      features: legs.map((leg) => ({
        type: "Feature",
        properties: { walk: leg.mode === "walk", colour: LEG_STYLE[leg.mode].colour },
        geometry: { type: "LineString", coordinates: leg.geometry.coordinates },
      })),
    };
    const boardings: maplibregl.Marker[] = [];
    const draw = () => {
      const source = m.getSource<maplibregl.GeoJSONSource>("route");
      if (source) source.setData(data);
      else {
        m.addSource("route", { type: "geojson", data });
        const line = { type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" } } as const;
        // A white edge keeps each colour readable over streets and water.
        m.addLayer({ ...line, id: "route-edge", filter: ["!", ["get", "walk"]], paint: { "line-color": "#ffffff", "line-width": 9 } });
        m.addLayer({ ...line, id: "route-ride", filter: ["!", ["get", "walk"]], paint: { "line-color": ["get", "colour"], "line-width": 6 } });
        m.addLayer({ ...line, id: "route-walk", filter: ["get", "walk"], paint: { "line-color": ["get", "colour"], "line-width": 4, "line-dasharray": [0, 2] } });
      }
      // The line you board, where you board it. Decorative: the Routes list says the same in words.
      for (const leg of legs) {
        // Where to leave the car on a park-and-ride way.
        const end = leg.geometry.coordinates.at(-1);
        if (leg.to?.parking && end) {
          const park = document.createElement("span");
          park.setAttribute("aria-hidden", "true");
          park.className = "rounded bg-blue-600 px-1.5 py-0.5 text-xs font-bold text-white shadow ring-2 ring-white";
          park.textContent = "P";
          boardings.push(new maplibregl.Marker({ element: park }).setLngLat(end as [number, number]).addTo(m));
        }
        const start = leg.geometry.coordinates[0];
        if (!leg.line || !start) continue;
        const label = document.createElement("span");
        label.setAttribute("aria-hidden", "true");
        label.className = "rounded px-1.5 py-0.5 text-xs font-bold text-white shadow ring-2 ring-white";
        label.style.backgroundColor = LEG_STYLE[leg.mode].colour;
        label.textContent = leg.line.name;
        boardings.push(new maplibregl.Marker({ element: label }).setLngLat(start as [number, number]).addTo(m));
      }
      // Where to park too: where the trip ends for a driver.
      const { picks = [], places = [] } = parkingRef.current ?? {};
      const parkingAt = [...picks, ...places].map(({ lat, lon }): [number, number] => [lon, lat]);
      const coordinates = [...(legs.flatMap((leg) => leg.geometry.coordinates) as [number, number][]), ...parkingAt];
      if (!coordinates.length) return;
      const bounds = coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
      m.fitBounds(bounds, { padding: ROUTE_ROOM_PX, maxZoom: 16, duration: reducedMotion() ? 0 : 600 });
    };
    if (m.isStyleLoaded()) draw();
    // Not "load": that fires once, and the style also reads as not loaded while a source updates after it.
    else m.once("idle", draw);
    return () => {
      m.off("idle", draw);
      for (const boarding of boardings) boarding.remove();
    };
  }, [routeKey, parkingKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const { picks = [], places = [] } = parkingRef.current ?? {};
    const data: maplibregl.GeoJSONSourceSpecification["data"] = {
      type: "FeatureCollection",
      features: places.map(({ lat, lon, kind, label }) => ({ type: "Feature", properties: { kind, label }, geometry: { type: "Point", coordinates: [lon, lat] } })),
    };
    const numbered: maplibregl.Marker[] = [];
    // A tapped spot says what it offers. Not for keyboards: the panel's picks say the same of the ones worth it.
    const spotPopup = new maplibregl.Popup({ closeButton: false, offset: 8, className: "parking-spot" });
    const showSpot = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const text = document.createElement("p");
      text.className = "px-2.5 py-1.5 text-xs";
      text.textContent = String(feature.properties.label);
      spotPopup.setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(text).addTo(m);
    };
    const pointer = () => (m.getCanvas().style.cursor = "pointer");
    const unpointer = () => (m.getCanvas().style.cursor = "");
    const draw = () => {
      const source = m.getSource<maplibregl.GeoJSONSource>("parking");
      if (source) source.setData(data);
      else {
        m.addSource("parking", { type: "geojson", data });
        m.addLayer({
          id: "parking-places",
          type: "circle",
          source: "parking",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 6],
            "circle-color": ["match", ["get", "kind"], "free", "#059669", "paid", "#2563eb", "#94a3b8"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.8,
          },
        });
      }
      m.on("click", "parking-places", showSpot);
      m.on("mouseenter", "parking-places", pointer);
      m.on("mouseleave", "parking-places", unpointer);
      // Decorative: the panel lists the same picks in words, in the same order.
      picks.forEach(({ lat, lon }, i) => {
        const label = document.createElement("span");
        label.setAttribute("aria-hidden", "true");
        label.className = "grid size-6 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white shadow ring-2 ring-white";
        label.textContent = String(i + 1);
        numbered.push(new maplibregl.Marker({ element: label }).setLngLat([lon, lat]).addTo(m));
      });
    };
    if (m.isStyleLoaded()) draw();
    // Not "load": that fires once, and the style also reads as not loaded while a source updates after it.
    else m.once("idle", draw);
    return () => {
      m.off("idle", draw);
      m.off("click", "parking-places", showSpot);
      m.off("mouseenter", "parking-places", pointer);
      m.off("mouseleave", "parking-places", unpointer);
      spotPopup.remove();
      for (const marker of numbered) marker.remove();
    };
  }, [parkingKey]);

  // The destination: a dark pin with its name, apart from the point's blue one.
  const destinationKey = destination ? `${destination.lat},${destination.lon},${destination.name}` : "";
  const destinationRef = useRef(destination);
  destinationRef.current = destination;
  useEffect(() => {
    const m = map.current;
    const to = destinationRef.current;
    if (!m || !to) return;
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    element.className = "flex flex-col items-center";
    const name = document.createElement("span");
    name.className = "max-w-40 truncate rounded bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white shadow ring-2 ring-white";
    name.textContent = to.name;
    const dot = document.createElement("span");
    dot.className = "mt-0.5 size-3 rounded-full bg-slate-900 ring-2 ring-white";
    element.append(name, dot);
    const marker = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([to.lon, to.lat]).addTo(m);
    return () => void marker.remove();
  }, [destinationKey]);

  const focusKey = focus?.key;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const m = map.current;
    const at = focusRef.current;
    if (!m || !at || focusKey === undefined) return;
    m.easeTo({ center: [at.lon, at.lat], zoom: Math.max(m.getZoom(), 17), duration: reducedMotion() ? 0 : 600 });
  }, [focusKey]);

  // The pins' areas and lines, lightly, under them. Redrawn when what's outlined changes.
  const outlines = pins.flatMap(({ event }, i) => {
    const geometry = pins.findIndex((p) => p.event.id === event.id) === i ? outlineOf(event) : undefined;
    return geometry ? [{ id: event.id, tone: toneOf(event), geometry }] : [];
  });
  const outlinesRef = useRef(outlines);
  outlinesRef.current = outlines;
  const outlinesKey = outlines.map(({ id, tone }) => `${id}:${tone}`).join(",");
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const data: maplibregl.GeoJSONSourceSpecification["data"] = {
      type: "FeatureCollection",
      features: outlinesRef.current.map(({ id, tone, geometry }) => ({
        type: "Feature",
        properties: { id, colour: TONE_COLOURS[tone] },
        geometry,
      })),
    };
    const draw = () => {
      const source = m.getSource<maplibregl.GeoJSONSource>("outlines");
      if (source) return source.setData(data);
      m.addSource("outlines", { type: "geojson", data });
      // Under a Trip's route, which is drawn later.
      const area = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false] as maplibregl.FilterSpecification;
      m.addLayer({ id: "outline-areas", type: "fill", source: "outlines", filter: area, paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.15 } });
      m.addLayer({ id: "outline-lines", type: "line", source: "outlines", paint: { "line-color": ["get", "colour"], "line-width": 3, "line-opacity": 0.6 } });
    };
    if (m.isStyleLoaded()) draw();
    else m.once("idle", draw);
    return () => void m.off("idle", draw);
  }, [outlinesKey]);

  // The selected Event's shape, or one pointed at in the list, drawn bold; the rest stay faint.
  const emphasisedKey = emphasised.join(",");
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const on = ["in", ["get", "id"], ["literal", emphasisedKey ? emphasisedKey.split(",") : []]] as maplibregl.ExpressionSpecification;
    const paint = () => {
      if (!m.getLayer("outline-areas")) return;
      m.setPaintProperty("outline-areas", "fill-opacity", ["case", on, 0.35, 0.12]);
      m.setPaintProperty("outline-lines", "line-width", ["case", on, 6, 3]);
      m.setPaintProperty("outline-lines", "line-opacity", ["case", on, 1, 0.5]);
    };
    if (m.isStyleLoaded()) paint();
    else m.once("idle", paint);
    return () => void m.off("idle", paint);
  }, [emphasisedKey, outlinesKey]);

  // How far the map looks: a faint circle around the point. Redrawn when the circle itself changes.
  const pointRef = useRef(point);
  pointRef.current = point;
  const radiusKey = point && radiusM ? `${point.lat},${point.lon},${radiusM}` : "";
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const ring = pointRef.current && radiusM ? circleAround(pointRef.current, radiusM) : [];
    const data: maplibregl.GeoJSONSourceSpecification["data"] = {
      type: "FeatureCollection",
      features: ring.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } }] : [],
    };
    const draw = () => {
      const source = m.getSource<maplibregl.GeoJSONSource>("radius");
      if (source) return source.setData(data);
      m.addSource("radius", { type: "geojson", data });
      m.addLayer({ id: "radius", type: "line", source: "radius", paint: { "line-color": "#2563eb", "line-width": 1.5, "line-opacity": 0.35, "line-dasharray": [2, 2] } });
    };
    if (m.isStyleLoaded()) draw();
    else m.once("idle", draw);
    return () => void m.off("idle", draw);
  }, [radiusKey]);

  // The popup follows its pin; the map pans so the pin sits low enough for the card to fit above it.
  const popupKey = popup?.pinKey;
  // Whether to group at all: a new renderGroup each render doesn't regroup.
  const grouping = renderGroup !== undefined;

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const markers = pinMarkers.current;
    // Pins that overlap on screen become one group; the one with its card open always stands alone.
    const items = pins.map((pin) => ({ pin, ...m.project(pin.lngLat) }));
    const grouped = grouping ? groupNear(items.filter(({ pin }) => pin.key !== popupKey), GROUP_PX) : items.map((item) => [item]);
    const order = (group: typeof items) => pins.indexOf(group[0]!.pin);
    const groups = [...grouped, ...items.filter(({ pin }) => grouping && pin.key === popupKey).map((item) => [item])].sort((a, b) => order(a) - order(b));
    const wanted: Slot[] = groups.map((group) => {
      const [{ pin }] = group as [(typeof items)[number]];
      if (group.length === 1) return { kind: "pin", key: pin.key, pin, element: undefined! };
      const members = group.map((item) => item.pin);
      const zoomIn = sameSpot(members)
        ? undefined
        : () => {
            const bounds = members.reduce((b, p) => b.extend(p.lngLat), new maplibregl.LngLatBounds(pin.lngLat, pin.lngLat));
            m.fitBounds(bounds, { padding: 80, maxZoom: 19, duration: reducedMotion() ? 0 : 500 });
          };
      return { kind: "group", key: `group:${pin.key}`, pins: members, zoomIn, element: undefined! };
    });
    const keys = new Set(wanted.map((slot) => slot.key));
    for (const [key, old] of markers) {
      if (!keys.has(key)) {
        old.remove();
        markers.delete(key);
      }
    }
    const next = wanted.map((slot) => {
      const at = slot.kind === "pin" ? slot.pin.lngLat : slot.pins[0]!.lngLat;
      let slotMarker = markers.get(slot.key);
      if (!slotMarker) {
        slotMarker = new maplibregl.Marker({ element: document.createElement("div") }).setLngLat(at).addTo(m);
        markers.set(slot.key, slotMarker);
      } else {
        slotMarker.setLngLat(at);
      }
      const element = slotMarker.getElement();
      // Markers sit in the DOM in the order they were added; re-appending keeps the tab order nearest first.
      element.parentElement?.appendChild(element);
      return { ...slot, element };
    });
    setSlots(next);
  }, [pins, zoom, popupKey, grouping]);

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
      className="absolute inset-0 [&_.maplibregl-ctrl-bottom-right]:mb-38 lg:[&_.maplibregl-ctrl-bottom-right]:mb-0 [&_.maplibregl-popup-content]:rounded-xl! [&_.maplibregl-popup-content]:p-0! [&_.maplibregl-popup-content]:shadow-xl!"
      role="region"
      aria-label={t("map")}
    >
      <div ref={container} className="h-full w-full" />
      {slots.map((slot) =>
        createPortal(slot.kind === "pin" ? renderPin(slot.pin) : renderGroup?.(slot.pins, slot.zoomIn), slot.element, slot.key),
      )}
      {popup && createPortal(popup.content, popupElement)}
    </div>
  );
}
