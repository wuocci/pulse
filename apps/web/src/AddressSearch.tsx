import type { GeocodeResult } from "@pulse/client";
import { Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { GeocodeError, useGeocode } from "./api.ts";
import type { LatLon } from "./platform.tsx";

// Finds an address or place: to move the point there, or as a Trip's From or To. A combobox (ARIA 1.2): focus stays in the field, the arrow
// keys move through the suggestions, Enter picks one, Escape closes them and then clears the field.

const DEBOUNCE_MS = 250;

export interface AddressSearchProps {
  // Results near here rank first.
  point: LatLon | undefined;
  lang: string;
  onPick: (place: GeocodeResult) => void;
  // Defaults to "Search for an address or place".
  label?: string;
  placeholder?: string;
  // What the field shows to begin with, e.g. a Trip's destination from a shared link.
  initialText?: string;
  autoFocus?: boolean;
}

export function AddressSearch({ point, lang, onPick, label, placeholder, initialText = "", autoFocus = false }: AddressSearchProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [text, setText] = useState(initialText);
  const [typed, setTyped] = useState(initialText);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Asks once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setTyped(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const geocode = useGeocode(typed, point, lang);
  const results = geocode.data ?? [];
  const searching = typed.trim().length >= 2;
  const message = (() => {
    if (!searching || geocode.isPending) return null;
    if (geocode.error) return t(geocode.error instanceof GeocodeError && geocode.error.reason === "off" ? "searchOff" : "searchFailed");
    return results.length ? null : t("searchNone");
  })();
  const showList = open && searching && (results.length > 0 || message !== null);
  const optionId = (i: number) => `${listId}-${i}`;

  const pick = (place: GeocodeResult) => {
    setText(place.name);
    setTyped(place.name);
    setOpen(false);
    setActive(-1);
    onPick(place);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      setOpen(true);
      const n = results.length;
      const down = e.key === "ArrowDown";
      setActive((i) => (down ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter" && showList && results.length) {
      e.preventDefault();
      pick(results[Math.max(active, 0)]!);
    } else if (e.key === "Escape") {
      // Handled here, so it doesn't also close an open Event card.
      e.stopPropagation();
      if (showList) setOpen(false);
      else setText("");
      setActive(-1);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      {showList && (
        <div className="absolute inset-x-0 bottom-full mb-2 lg:top-full lg:bottom-auto lg:mt-2 lg:mb-0 overflow-hidden rounded-xl border bg-popover shadow-xl">
          {results.length > 0 && (
            <ul id={listId} role="listbox" aria-label={label ?? t("searchLabel")}>
              {results.map((place, i) => (
                <li
                  key={place.label}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className="cursor-pointer px-4 py-3 text-sm aria-selected:bg-muted"
                  // Picks before the field loses focus.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(place)}
                >
                  {place.label}
                </li>
              ))}
            </ul>
          )}
          {/* Read out by the live region below, so not twice. */}
          {message && (
            <p aria-hidden className="px-4 py-3 text-sm text-muted-foreground">
              {message}
            </p>
          )}
        </div>
      )}
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        role="combobox"
        aria-label={label ?? t("searchLabel")}
        aria-expanded={showList && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(active >= 0 && showList ? { "aria-activedescendant": optionId(active) } : {})}
        autoComplete="off"
        enterKeyHint="search"
        placeholder={placeholder ?? t("searchPlaceholder")}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-11 w-full rounded-lg bg-muted pr-10 pl-9 text-base outline-none select-text placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          aria-label={t("clearSearch")}
          className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center text-muted-foreground"
          onClick={() => {
            setText("");
            setActive(-1);
          }}
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
      <p aria-live="polite" className="sr-only">
        {showList && results.length ? t("searchResults", { count: results.length }) : (message ?? "")}
      </p>
    </div>
  );
}
