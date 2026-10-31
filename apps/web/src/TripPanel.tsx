import type { GeocodeResult, Impact, TravelMode } from "@pulse/client";
import { Bike, Bus, Footprints, type LucideIcon, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AddressSearch } from "./AddressSearch.tsx";
import type { LatLon } from "./platform.tsx";

// Trip mode: From (the point unless changed) and To, then every travel mode at once with its time and how much
// is in the way, so the choice of mode is the comparison.

export const TRAVEL_MODES: TravelMode[] = ["transit", "walk", "bike"];
const MODE_ICONS: Record<TravelMode, LucideIcon> = { transit: Bus, walk: Footprints, bike: Bike };

export interface TripFormProps {
  point: LatLon | undefined;
  lang: string;
  fromName: string | undefined;
  toName: string | undefined;
  onFrom: (place: GeocodeResult) => void;
  onTo: (place: GeocodeResult) => void;
  onClose: () => void;
}

export function TripForm({ point, lang, fromName, toName, onFrom, onTo, onClose }: TripFormProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-2">
        <AddressSearch point={point} lang={lang} label={t("from")} placeholder={t("fromHere")} initialText={fromName ?? ""} onPick={onFrom} />
        <AddressSearch point={point} lang={lang} label={t("to")} placeholder={t("toPlaceholder")} initialText={toName ?? ""} autoFocus={!toName} onPick={onTo} />
      </div>
      <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t("closeRoute")} onClick={onClose}>
        <X aria-hidden />
      </Button>
    </div>
  );
}

export interface TravelModesProps {
  // Only what the chips show, so any shape of a planned Trip fits.
  trip: { plans: { mode: TravelMode; itineraries: { durationS: number; impact: Impact }[] }[] } | undefined;
  mode: TravelMode;
  onMode: (mode: TravelMode) => void;
}

export function TravelModes({ trip, mode, onMode }: TravelModesProps) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex min-w-0 flex-1 gap-1 rounded-lg bg-muted p-1">
      <legend className="sr-only">{t("travelMode")}</legend>
      {TRAVEL_MODES.map((option) => {
        const Icon = MODE_ICONS[option];
        const plan = trip?.plans.find((p) => p.mode === option);
        const best = plan?.itineraries[0];
        const time = best ? t("minutes", { count: Math.round(best.durationS / 60) }) : plan ? t("noRoute") : undefined;
        const impact = best && (best.impact === "consider" || best.impact === "major") ? best.impact : undefined;
        const label = [t(`mode_${option}`), time, impact && t(`impact_${impact}`)].filter(Boolean).join(", ");
        return (
          <label
            key={option}
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium has-checked:bg-background has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input type="radio" name="mode" className="sr-only" aria-label={label} checked={mode === option} onChange={() => onMode(option)} />
            <Icon aria-hidden className="size-4 shrink-0" />
            <span aria-hidden className={`truncate ${best ? "" : "text-muted-foreground"}`}>
              {time ?? "…"}
            </span>
            {impact && <ImpactMark impact={impact} />}
          </label>
        );
      })}
    </fieldset>
  );
}

function ImpactMark({ impact }: { impact: Extract<Impact, "consider" | "major"> }) {
  return impact === "major" ? (
    <OctagonAlert aria-hidden className="size-4 shrink-0 text-red-600" />
  ) : (
    <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-600" />
  );
}
