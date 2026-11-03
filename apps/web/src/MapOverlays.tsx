import type { Event } from "@pulse/client";
import { Info, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { whenText } from "./EventCard.tsx";
import { textIn, toneOf, whenOf } from "./events.ts";
import { EventIcon, NOTICEABLE_RING, TONE_CLASSES } from "./map/EventPin.tsx";

// What sits over the map besides its pins: the chip for what's region-wide, and the legend.

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

export interface RegionWideProps {
  events: Event[];
  selectedId: string | undefined;
  languages: readonly string[];
  timeZone: string;
  onSelect: (id: string) => void;
  // The chosen notice's card, shown here: it has no pin to pop up from.
  card: ReactNode;
}

// "⚠ 2 region-wide notices": vague Events get no pin, so they're counted here and listed on a tap.
export function RegionWide({ events, selectedId, languages, timeZone, onSelect, card }: RegionWideProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useToggle();
  const listId = useId();
  if (!events.length) return null;
  const now = new Date();

  return (
    <div className="pointer-events-auto flex max-w-sm flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open || card !== null}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-sm font-medium shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TriangleAlert aria-hidden className="size-4 text-amber-600" />
        {t("regionWide", { count: events.length })}
      </button>
      {(open || card) && (
        <div id={listId} className="w-full rounded-xl bg-background shadow-xl">
          {card ?? (
            <ul aria-label={t("regionWideTitle")} className="space-y-1 p-2">
              {events.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    data-event-id={event.id}
                    aria-current={event.id === selectedId ? true : undefined}
                    onClick={() => onSelect(event.id)}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={`grid size-8 shrink-0 place-items-center rounded-full border-2 ${TONE_CLASSES[toneOf(event)]}`}>
                      <EventIcon event={event} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-sm leading-snug font-medium">{textIn(event.title, languages)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{whenText(whenOf(event, timeZone, now), t)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
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
  const heading = "pt-1 text-xs font-semibold text-muted-foreground uppercase";

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      <Button variant="secondary" size="icon" className="size-11 rounded-full shadow" aria-label={t("legend")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Info aria-hidden />
      </Button>
      {open && (
        <section aria-labelledby={titleId} className="max-h-[70dvh] w-72 space-y-2 overflow-y-auto rounded-xl bg-background p-3 text-sm shadow-xl">
          <div className="flex items-center justify-between">
            <h2 id={titleId} className="font-semibold">
              {t("legend")}
            </h2>
            <Button variant="ghost" size="icon" className="-mr-2 size-9" aria-label={t("close")} onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </div>
          <h3 className={heading}>{t("legendColours")}</h3>
          <ul className="space-y-2">
            {(["quiet", "consider", "major"] as const).map((tone) => (
              <li key={tone} className={row}>
                <span aria-hidden className={`${swatch} ${TONE_CLASSES[tone]}`} />
                <span>{t(`legend_${tone}`)}</span>
              </li>
            ))}
          </ul>
          <h3 className={heading}>{t("legendPins")}</h3>
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
            <li className="text-muted-foreground">{t("legendIcon")}</li>
          </ul>
          <h3 className={heading}>{t("legendShapes")}</h3>
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
          <p className="text-xs text-muted-foreground">{t("legendRegionWide")}</p>
        </section>
      )}
    </div>
  );
}
