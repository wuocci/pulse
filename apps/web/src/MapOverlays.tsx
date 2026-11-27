import { Info, PartyPopper, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { NOTICEABLE_RING, TONE_CLASSES } from "./map/EventPin.tsx";

// What sits over the map besides its pins: the legend.

// Open until Escape, the close button or the toggle again.
function useToggle() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return [open, setOpen] as const;
}

// The legend's shape samples, in the map's own colours (PointMap's TONE_COLOURS and radius line).
const AREA_SWATCH = "size-7 shrink-0 rounded-sm border border-amber-600 bg-amber-600/15";
const LINE_SWATCH = "h-1 w-7 shrink-0 rounded-full bg-amber-600/60";
const RADIUS_SWATCH = "size-7 shrink-0 rounded-full border-[1.5px] border-dashed border-blue-600/50";
const POINT_SWATCH = "size-3.5 shrink-0 rounded-full bg-[#3FB1CE] ring-2 ring-white mx-1.75";

// What the map's marks mean, behind ⓘ so the map itself stays clean. `radiusM`: how far the map looks, when it
// draws that circle.
export function Legend({ radiusM }: { radiusM?: number | undefined }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useToggle();
  const titleId = useId();
  const swatch = "grid size-7 shrink-0 place-items-center rounded-full border-2";
  const row = "flex items-center gap-2.5";

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      <button type="button" className="map-btn" aria-label={t("legend")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Info aria-hidden className="size-5" />
      </button>
      {open && (
        <section aria-labelledby={titleId} className="map-panel">
          <div className="map-panel-head">
            <h2 id={titleId} className="settings-head">
              {t("legend")}
            </h2>
            <button type="button" className="map-press-close" aria-label={t("close")} onClick={() => setOpen(false)}>
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <h3 className="map-panel-label">{t("legendColours")}</h3>
          <ul className="space-y-2">
            {(["quiet", "consider", "major"] as const).map((tone) => (
              <li key={tone} className={row}>
                <span aria-hidden className={`${swatch} ${TONE_CLASSES[tone]}`} />
                <span>{t(`legend_${tone}`)}</span>
              </li>
            ))}
          </ul>
          <h3 className="map-panel-label">{t("legendPins")}</h3>
          <ul className="space-y-2">
            <li className={row}>
              <span aria-hidden className={`${swatch} ${TONE_CLASSES.quiet} ${NOTICEABLE_RING}`} />
              <span>{t("legendNoticeable")}</span>
            </li>
            <li className={row}>
              <span aria-hidden className={`${swatch} ${TONE_CLASSES.quiet} opacity-50`} />
              <span>{t("legendEnded")}</span>
            </li>
            <li className={row}>
              <span aria-hidden className={`${swatch} ${TONE_CLASSES.quiet} text-xs font-bold`}>
                3
              </span>
              <span>{t("legendGroup")}</span>
            </li>
            <li className={row}>
              <span aria-hidden className={`${swatch} ${TONE_CLASSES.quiet}`}>
                <PartyPopper className="size-4" />
              </span>
              <span>{t("legendPublicEvent")}</span>
            </li>
            <li className="map-panel-note">{t("legendIcon")}</li>
          </ul>
          <h3 className="map-panel-label">{t("legendShapes")}</h3>
          <ul className="space-y-2">
            <li className={row}>
              <span aria-hidden className={AREA_SWATCH} />
              <span>{t("legendArea")}</span>
            </li>
            <li className={row}>
              <span aria-hidden className={LINE_SWATCH} />
              <span>{t("legendLine")}</span>
            </li>
            {radiusM && (
              <li className={row}>
                <span aria-hidden className={RADIUS_SWATCH} />
                <span>{t("legendRadius", { distance: new Intl.NumberFormat(i18n.language, { style: "unit", unit: radiusM < 1000 ? "meter" : "kilometer" }).format(radiusM < 1000 ? radiusM : radiusM / 1000) })}</span>
              </li>
            )}
            <li className={row}>
              <span aria-hidden className={POINT_SWATCH} />
              <span>{t("legendPoint")}</span>
            </li>
          </ul>
          <p className="map-panel-note">{t("legendRegionWide")}</p>
        </section>
      )}
    </div>
  );
}
