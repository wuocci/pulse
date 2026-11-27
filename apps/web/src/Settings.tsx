import { Link, useRouter } from "@tanstack/react-router";
import { Monitor, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { PlacesList } from "./Places.tsx";
import { setThemeChoice, type ThemeChoice, useTheme } from "./theme.ts";
import { ALL_MODES, SPEED_RANGE, useSpeeds, useTravelModes } from "./travelModes.ts";

const CHOICES: { choice: ThemeChoice; key: "themeAuto" | "themeLight" | "themeDark"; Icon: typeof Sun }[] = [
  { choice: "auto", key: "themeAuto", Icon: Monitor },
  { choice: "light", key: "themeLight", Icon: Sun },
  { choice: "dark", key: "themeDark", Icon: Moon },
];

// ⚙ over the map: opens Settings, a view of its own (2026-11-27; it was a pop-up, too small once Routines join it).
export function SettingsButton({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link to="/settings" aria-label={t("settings")} className={`map-btn ${className}`}>
      <SettingsIcon aria-hidden className="size-5" />
    </Link>
  );
}

// Set once, for every Trip and screen (design round 2026-11-25): how Pulse looks, the ways you travel, how fast you
// walk and cycle, and your places (public transport and driving keep their timetables and roads).
export function SettingsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { choice } = useTheme();
  const { modes, toggle } = useTravelModes();
  const { speeds, set } = useSpeeds();
  const id = useId();
  // Back to where ⚙ was pressed; a Settings link opened on its own goes to the start screen.
  const back = () => (router.history.canGoBack() ? router.history.back() : void router.navigate({ to: "/" }));

  return (
    <main className="signage">
      <div className="home">
        <div className="around-top">
          <button type="button" className="around-back" onClick={back}>
            ‹ {t("back")}
          </button>
        </div>
        <h1 className="settings-title">{t("settings")}</h1>
        <div className="settings">
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
      </div>
    </main>
  );
}
