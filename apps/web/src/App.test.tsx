import type { Region } from "@pulse/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { PointMapProps } from "./map/PointMap.tsx";
import { type DeviceLocation, type LatLon, LocationError, type Platform } from "./platform.tsx";

// The real map draws with WebGL, which jsdom lacks: this one shows what it was given and can be long-pressed.
vi.mock("./map/PointMap.tsx", () => ({
  PointMap: ({ point, onLongPress }: PointMapProps) => (
    <div data-testid="map" data-point={point ? `${point.lat},${point.lon}` : ""}>
      <button type="button" onClick={() => onLongPress({ lat: 60.2, lon: 24.9 })}>
        long-press the map
      </button>
    </div>
  ),
}));

// The API's answer for /v0/regions: one Region, its bbox centre at 60.22500, 24.85000.
const region: Region = {
  id: "test-region",
  name: { en: "Test region" },
  bbox: [24.4, 60.0, 25.3, 60.45],
  timeZone: "Europe/Helsinki",
  languages: ["fi", "sv", "en"],
};
const server = setupServer(http.get("*/v0/regions", () => HttpResponse.json({ regions: [region] })));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const KAMPPI: LatLon = { lat: 60.169, lon: 24.93164 };

// A device whose location and storage the test controls.
function fakePlatform({ stored, location }: { stored?: string; location?: LatLon | "denied" } = {}) {
  const storage = new Map(stored ? [["point", stored]] : []);
  // The location watch, so a test can send fixes and see whether it is still on.
  const watching: { active: boolean; onFix?: (p: LatLon) => void; onError?: (e: LocationError) => void } = { active: false };
  const deviceLocation: DeviceLocation = {
    async current() {
      if (!location) throw new Error("no location in this test");
      if (location === "denied") throw new LocationError("denied");
      return location;
    },
    watch(onFix, onError) {
      watching.onFix = onFix;
      watching.onError = onError;
      watching.active = true;
      return () => {
        watching.active = false;
      };
    },
  };
  const platform: Platform = {
    location: deviceLocation,
    storage: {
      get: async (key) => storage.get(key) ?? null,
      set: async (key, value) => void storage.set(key, value),
    },
  };
  return { platform, storage, watching };
}

function renderApp(url: string, platform = fakePlatform().platform) {
  const history = createMemoryHistory({ initialEntries: [url] });
  render(<App platform={platform} history={history} />);
  return history;
}

const shownPoint = async () => (await screen.findByText(/^Showing /)).textContent;

describe("the app shell", () => {
  it("has a main region named for screen readers", async () => {
    renderApp("/");

    expect(await screen.findByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Pulse" })).toBeInTheDocument();
  });
});

describe("where the app is looking", () => {
  it("starts at the Region's centre when nothing is known", async () => {
    renderApp("/");

    expect(await shownPoint()).toBe("Showing 60.22500, 24.85000");
  });

  it("starts at the point remembered on the device", async () => {
    renderApp("/", fakePlatform({ stored: "60.16900,24.93164" }).platform);

    expect(await shownPoint()).toBe("Showing 60.16900, 24.93164");
  });

  it("lets the point in the URL win, so a shared link shows the same place", async () => {
    renderApp("/?at=60.17000,24.95000", fakePlatform({ stored: "60.16900,24.93164" }).platform);

    expect(await shownPoint()).toBe("Showing 60.17000, 24.95000");
  });

  it("ignores a malformed point in the URL", async () => {
    renderApp("/?at=Töölö");

    expect(await shownPoint()).toBe("Showing 60.22500, 24.85000");
  });
});

describe("Use my location", () => {
  it("moves the point to the device's location, into the URL and onto the device", async () => {
    const { platform, storage } = fakePlatform({ location: KAMPPI });
    const history = renderApp("/", platform);

    await userEvent.click(await screen.findByRole("button", { name: "Use my location" }));

    expect(await screen.findByText("Showing 60.16900, 24.93164")).toBeInTheDocument();
    expect(history.location.search).toContain("at=60.16900%2C24.93164");
    expect(storage.get("point")).toBe("60.16900,24.93164");
  });

  it("explains a refused permission and stays where it was", async () => {
    renderApp("/?at=60.17000,24.95000", fakePlatform({ location: "denied" }).platform);

    await userEvent.click(await screen.findByRole("button", { name: "Use my location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location is off");
    expect(await shownPoint()).toBe("Showing 60.17000, 24.95000");
  });
});

describe("the map", () => {
  it("is centred on the point", async () => {
    renderApp("/?at=60.17000,24.95000");

    expect(await screen.findByTestId("map")).toHaveAttribute("data-point", "60.17,24.95");
  });

  it("moves the point where it's long-pressed, into the URL and onto the device", async () => {
    const { platform, storage } = fakePlatform();
    const history = renderApp("/", platform);

    await userEvent.click(await screen.findByRole("button", { name: "long-press the map" }));

    expect(await screen.findByText("Showing 60.20000, 24.90000")).toBeInTheDocument();
    expect(history.location.search).toContain("at=60.20000%2C24.90000");
    expect(storage.get("point")).toBe("60.20000,24.90000");
  });
});

describe("Follow me", () => {
  it("keeps the point on the device's location while on, and stops watching when off", async () => {
    const { platform, watching } = fakePlatform();
    renderApp("/", platform);
    const toggle = await screen.findByRole("button", { name: "Follow me" });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    act(() => watching.onFix?.(KAMPPI));
    expect(await screen.findByText("Showing 60.16900, 24.93164")).toBeInTheDocument();
    act(() => watching.onFix?.({ lat: 60.17, lon: 24.94 }));
    expect(await screen.findByText("Showing 60.17000, 24.94000")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(watching.active).toBe(false);
  });

  it("turns itself off and explains when location is refused", async () => {
    const { platform, watching } = fakePlatform();
    renderApp("/", platform);
    const toggle = await screen.findByRole("button", { name: "Follow me" });

    await userEvent.click(toggle);
    act(() => watching.onError?.(new LocationError("denied")));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location is off");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(watching.active).toBe(false);
  });
});

describe("the bottom sheet", () => {
  it("is always there, titled, over the map", async () => {
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Around this point" })).toBeInTheDocument();
  });

  it("can be expanded and collapsed without dragging, for keyboards and screen readers", async () => {
    renderApp("/");
    const toggle = await screen.findByRole("button", { name: "Expand" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Collapse");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
