import { Monitor, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlacesList } from "./Places.tsx";
import { setThemeChoice, type ThemeChoice, useTheme } from "./theme.ts";
import { ALL_MODES, SPEED_RANGE, useSpeeds, useTravelModes } from "./travelModes.ts";

const CHOICES: { choice: ThemeChoice; key: "themeAuto" | "themeLight" | "themeDark"; Icon: typeof Sun }[] = [
  { choice: "auto", key: "themeAuto", Icon: Monitor },
  { choice: "light", key: "themeLight", Icon: Sun },
  { choice: "dark", key: "themeDark", Icon: Moon },
];

// ⚙: set once, for every Trip and screen (design round 2026-11-25): how Pulse looks, the ways you travel, how
// fast you walk and cycle, and your places (public transport and driving keep their timetables and roads). Opens above itself, from
// its left or right edge.
export function Settings({ align, className = "" }: { align: "left" | "right"; className?: string }) {
  const { t } = useTranslation();
  const { choice } = useTheme();
  const { modes, toggle } = useTravelModes();
  const { speeds, set } = useSpeeds();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={t("settings")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="grid size-12 place-items-center rounded-full border bg-card/90 shadow-lg backdrop-blur outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-11"
      >
        <SettingsIcon aria-hidden className="size-5" />
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={t("settings")} className={`settings absolute bottom-full mb-2 ${align === "left" ? "left-0" : "right-0"}`}>
          <fieldset>
            <legend className="settings-head">{t("appearance")}</legend>
            {CHOICES.map(({ choice: option, key, Icon }) => (
              <label key={option} className="settings-option">
                <input type="radio" name={`${id}-theme`} className="sr-only" checked={choice === option} onChange={() => setThemeChoice(option)} />
                <Icon aria-hidden className="size-4" />
                {t(key)}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="settings-head">{t("tripYourModes")}</legend>
            <p className="settings-hint">{t("tripYourModesHint")}</p>
            {ALL_MODES.map((mode) => {
              const on = !!modes?.includes(mode);
              const range = mode === "walk" || mode === "bike" ? SPEED_RANGE[mode] : undefined;
              const kmh: number = range ? (speeds?.[mode as "walk" | "bike"] ?? range.usual) : 0;
              return (
                <div key={mode} className="settings-mode">
                  <label className="settings-check">
                    <input type="checkbox" checked={on} disabled={modes?.length === 1 && on} onChange={() => toggle(mode)} />
                    {t(`mode_${mode}`)}
                  </label>
                  {range && on && (
                    <label className="settings-speed">
                      <span className="sr-only">{t(mode === "walk" ? "speedWalk" : "speedBike")}</span>
                      <input
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={kmh}
                        aria-valuetext={t("kmh", { speed: kmh })}
                        onChange={(e) => set(mode as "walk" | "bike", Number(e.target.value))}
                      />
                      <span aria-hidden className="settings-speed-value">
                        {t("kmh", { speed: kmh })}
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </fieldset>
          <section aria-labelledby={`${id}-places`}>
            <h2 id={`${id}-places`} className="settings-head">
              {t("yourPlaces")}
            </h2>
            <p className="settings-hint">{t("placesHint")}</p>
            <PlacesList />
          </section>
        </div>
      )}
    </div>
  );
}
