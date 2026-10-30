import { LocateFixed, LocateIcon, Navigation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useRegions } from "./api.ts";
import { PointMap } from "./map/PointMap.tsx";
import { type LatLon, LocationError, usePlatform } from "./platform.tsx";
import { usePoint } from "./point.ts";
import { Sheet } from "./Sheet.tsx";

// The locate button, as in map apps: the first tap goes to my location, the second follows it, the third stops.
// Panning the map or choosing a place by hand also stops following.
type Locate = "off" | "centred" | "following";

// The one screen: the map, and the sheet with the status line and the controls.
export function Home() {
  const { t } = useTranslation();
  const { location } = usePlatform();
  const { point, setPoint } = usePoint();
  const regions = useRegions();
  const [locate, setLocate] = useState<Locate>("off");
  const [locating, setLocating] = useState(false);
  const [failure, setFailure] = useState<LocationError["reason"] | null>(null);

  // The watch is started once per "following"; it reads the latest setPoint from here.
  const setPointRef = useRef(setPoint);
  useEffect(() => {
    setPointRef.current = setPoint;
  }, [setPoint]);

  useEffect(() => {
    if (locate !== "following") return;
    return location.watch(
      (fix) => setPointRef.current(fix),
      (error) => {
        setFailure(error.reason);
        setLocate("off");
      },
    );
  }, [locate, location]);

  const onLocate = async () => {
    setFailure(null);
    if (locate === "centred") return setLocate("following");
    if (locate === "following") return setLocate("off");
    setLocating(true);
    try {
      setPoint(await location.current());
      setLocate("centred");
    } catch (error) {
      setFailure(error instanceof LocationError ? error.reason : "unavailable");
    } finally {
      setLocating(false);
    }
  };

  const choosePlace = (at: LatLon) => {
    setLocate("off");
    setPoint(at);
  };

  const label = { off: t("goToMyLocation"), centred: t("followMyLocation"), following: t("followingYourLocation") }[locate];
  const Icon = { off: LocateIcon, centred: LocateFixed, following: Navigation }[locate];

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <h1 className="sr-only">{t("appName")}</h1>
      <PointMap point={point} onLongPress={choosePlace} onPan={() => setLocate("off")} />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        {regions.isError && (
          <p role="alert" className="pointer-events-auto rounded-md bg-background px-3 py-2 text-sm shadow">
            {t("regionsFailed")}
          </p>
        )}
        {failure && (
          <p role="alert" className="pointer-events-auto max-w-sm rounded-md bg-background px-3 py-2 text-sm shadow">
            {t(failure === "denied" ? "locationDenied" : "locationUnavailable")}
          </p>
        )}
      </div>
      <Sheet
        title={t("sheetTitle")}
        controls={
          <Button
            variant={locate === "following" ? "default" : "secondary"}
            size="icon"
            className="ml-auto size-11"
            aria-label={locating ? t("locating") : label}
            aria-pressed={locate === "following"}
            disabled={locating}
            onClick={onLocate}
          >
            <Icon aria-hidden className={locate === "following" ? "fill-current" : undefined} />
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{t("sheetHint")}</p>
      </Sheet>
    </main>
  );
}
