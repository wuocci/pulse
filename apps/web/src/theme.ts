import { useSyncExternalStore } from "react";

// How Pulse looks: Paper (light) or Dusk (dark). Auto follows the phone, and changes with it at sunset. The choice is
// kept on the device; index.html applies it before the first paint, so there's no flash of the other one.

export type ThemeChoice = "auto" | "light" | "dark";

export const THEME_KEY = "theme";
const DARK_MEDIA = "(prefers-color-scheme: dark)";
// The browser's bar, in each theme's background.
const BAR_COLOUR = { light: "#f1f4f7", dark: "#252c38" };

const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

const phoneIsDark = () => window.matchMedia?.(DARK_MEDIA).matches ?? false;

function isDark(choice: ThemeChoice): boolean {
  return choice === "dark" || (choice === "auto" && phoneIsDark());
}

function apply() {
  const dark = isDark(read());
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLOUR[dark ? "dark" : "light"]);
  for (const listener of listeners) listener();
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not kept (private mode, storage off): still applied for now.
  }
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia?.(DARK_MEDIA);
  media?.addEventListener("change", apply);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", apply);
  };
}

// The choice (auto, light or dark) and whether Pulse is dark right now.
export function useTheme(): { choice: ThemeChoice; dark: boolean } {
  const choice = useSyncExternalStore(subscribe, read);
  const dark = useSyncExternalStore(subscribe, () => isDark(read()));
  return { choice, dark };
}
