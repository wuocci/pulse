import { createRootRoute, createRoute, createRouter, Outlet, type RouterHistory } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useRegions } from "./api.ts";
import { LocationError, usePlatform } from "./platform.tsx";
import { formatAt, usePoint } from "./point.ts";

// The view lives in the URL, so a reload, a shared link or a push deep link lands on the same thing.
// A malformed value is dropped rather than failing the page.
const SearchSchema = z.object({
  at: z.string().optional().catch(undefined),
});

function Home() {
  const { t } = useTranslation();
  const { location } = usePlatform();
  const { point, setPoint } = usePoint();
  const regions = useRegions();
  const [locating, setLocating] = useState(false);
  const [failure, setFailure] = useState<LocationError["reason"] | null>(null);

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

  return (
    <main className="relative h-dvh w-full bg-background text-foreground">
      <h1 className="sr-only">{t("appName")}</h1>
      <div className="absolute inset-x-0 top-0 flex flex-col gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        {point && <p className="text-sm text-muted-foreground">{t("showing", { point: formatAt(point).replace(",", ", ") })}</p>}
        {regions.isError && <p role="alert">{t("regionsFailed")}</p>}
        <Button className="min-h-11 self-start" onClick={useMyLocation} disabled={locating}>
          {locating ? t("locating") : t("useMyLocation")}
        </Button>
        {failure && <p role="alert">{t(failure === "denied" ? "locationDenied" : "locationUnavailable")}</p>}
      </div>
    </main>
  );
}

const rootRoute = createRootRoute({ component: Outlet });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", validateSearch: SearchSchema, component: Home });

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree: rootRoute.addChildren([homeRoute]), ...(history ? { history } : {}) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
