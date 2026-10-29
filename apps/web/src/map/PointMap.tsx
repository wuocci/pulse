import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { LatLon } from "../platform.tsx";
import { longPress } from "./long-press.ts";

// OpenFreeMap: free vector tiles, no key. Positron is muted, so Events drawn on top stand out.
const STYLE = "https://tiles.openfreemap.org/styles/positron";
const ZOOM = 15;
// The bottom sheet's peek height (Sheet.tsx).
const COVERED_BOTTOM_PX = 144;

export interface PointMapProps {
  // The point the app is looking around; the map centres on it and marks it.
  point: LatLon | undefined;
  // A press that rests on the map (touch), or a right-click (mouse): choose that place.
  onLongPress: (at: LatLon) => void;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PointMap({ point, onLongPress }: PointMapProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  // The map's handlers are bound once; they read the latest callback from here.
  const onLongPressRef = useRef(onLongPress);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({ container: container.current, style: STYLE, zoom: ZOOM, center: [0, 0], attributionControl: { compact: true } });
    // The bottom sheet covers the bottom of the map: centre the point in the part that shows.
    m.setPadding({ top: 0, right: 0, left: 0, bottom: COVERED_BOTTOM_PX });
    const choose = ({ lat, lng }: maplibregl.LngLat) => onLongPressRef.current({ lat, lon: lng });
    const press = longPress({ onLongPress: ({ x, y }) => choose(m.unproject([x, y])) });

    m.on("touchstart", (e) => (e.points.length === 1 ? press.down(e.point) : press.cancel()));
    m.on("touchmove", (e) => press.move(e.point));
    m.on("touchend", press.up);
    m.on("touchcancel", press.cancel);
    m.on("dragstart", press.cancel);
    // Mouse: right-click. Touch browsers also fire contextmenu on a long press; the detector above handles those.
    m.on("contextmenu", (e) => {
      if (e.originalEvent instanceof PointerEvent && e.originalEvent.pointerType === "touch") return;
      choose(e.lngLat);
    });

    map.current = m;
    return () => {
      press.cancel();
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

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
  return (
    <div className="absolute inset-0 [&_.maplibregl-ctrl-bottom-right]:mb-[144px]" role="region" aria-label={t("map")}>
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
