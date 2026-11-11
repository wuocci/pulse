import { Monitor, Moon, Settings, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { setThemeChoice, type ThemeChoice, useTheme } from "./theme.ts";

const CHOICES: { choice: ThemeChoice; key: "themeAuto" | "themeLight" | "themeDark"; Icon: typeof Sun }[] = [
  { choice: "auto", key: "themeAuto", Icon: Monitor },
  { choice: "light", key: "themeLight", Icon: Sun },
  { choice: "dark", key: "themeDark", Icon: Moon },
];

// ⚙: how Pulse looks, like the phone or always light or dark. Opens above itself, from its left or right edge.
export function ThemeSetting({ align, className = "" }: { align: "left" | "right"; className?: string }) {
  const { t } = useTranslation();
  const { choice } = useTheme();
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
        aria-label={t("appearance")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="grid size-12 place-items-center rounded-full border bg-card/90 lg:size-11 shadow-lg backdrop-blur outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings aria-hidden className="size-5" />
      </button>
      {open && (
        <fieldset
          id={id}
          className={`absolute bottom-full mb-2 w-48 space-y-1 rounded-3xl border bg-card p-2 shadow-xl ${align === "left" ? "left-0" : "right-0"}`}
        >
          <legend className="sr-only">{t("appearance")}</legend>
          {CHOICES.map(({ choice: option, key, Icon }) => (
            <label
              key={option}
              className="flex h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-sm font-medium has-checked:bg-muted has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input type="radio" name={`${id}-theme`} className="sr-only" checked={choice === option} onChange={() => setThemeChoice(option)} />
              <Icon aria-hidden className="size-4" />
              {t(key)}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
