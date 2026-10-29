import { LocateFixed, Navigation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useRegions } from "./api.ts";
import { PointMap } from "./map/PointMap.tsx";
import { type LatLon, LocationError, usePlatform } from "./platform.tsx";
import { formatAt, usePoint } from "./point.ts";

// The one screen: a full-screen map around the point, and the controls for choosing it.
export function Home() {
  const { t } = useTranslation();
  const { location } = usePlatform();
  const { point, setPoint } = usePoint();
  const regions = useRegions();
  const [locating, setLocating] = useState(false);
  const [following, setFollowing] = useState(false);
  const [failure, setFailure] = useState<LocationError["reason"] | null>(null);

  // The watch is started once per "Follow me"; it reads the latest setPoint from here.
  const setPointRef = useRef(setPoint);
  useEffect(() => {
    setPointRef.current = setPoint;
  }, [setPoint]);

  useEffect(() => {
    if (!following) return;
    return location.watch(
      (fix) => setPointRef.current(fix),
      (error) => {
        setFailure(error.reason);
        setFollowing(false);
      },
    );
  }, [following, location]);

  const useMyLocation = async () => {
    setLocating(true);
    setFailure(null);
    try {
      setPoint(await location.current());
    } catch (error) {
      setFailure(error instanceof LocationError ? error.reason : "unavailable");
    } finally {
      setLocating(false);
    }
  };

  const toggleFollowing = () => {
    setFailure(null);
    setFollowing((on) => !on);
  };

  // Choosing a place by hand stops following, or the next fix would take the point straight back.
  const choosePlace = (at: LatLon) => {
    setFollowing(false);
    setPoint(at);
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <h1 className="sr-only">{t("appName")}</h1>
      <PointMap point={point} onLongPress={choosePlace} />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex gap-2">
          <Button className="min-h-11" onClick={useMyLocation} disabled={locating}>
            <LocateFixed aria-hidden />
            {locating ? t("locating") : t("useMyLocation")}
          </Button>
          <Button className="min-h-11" variant={following ? "default" : "secondary"} aria-pressed={following} onClick={toggleFollowing}>
            <Navigation aria-hidden />
            {t("followMe")}
          </Button>
        </div>
        {point && (
          <p className="rounded-md bg-background/90 px-2 py-1 text-sm text-muted-foreground">
            {t("showing", { point: formatAt(point).replace(",", ", ") })}
          </p>
        )}
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
    </main>
  );
}
