import type { Region } from "@pulse/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { PointMapProps } from "./map/PointMap.tsx";
import { type DeviceLocation, type LatLon, LocationError, type Platform } from "./platform.tsx";

// The real map draws with WebGL, which jsdom lacks: this one shows what it was given, and can be long-pressed
// and panned.
vi.mock("./map/PointMap.tsx", () => ({
  PointMap: ({ point, onLongPress, onPan }: PointMapProps) => (
    <div data-testid="map" data-point={point ? `${point.lat},${point.lon}` : ""}>
      <button type="button" onClick={() => onLongPress({ lat: 60.2, lon: 24.9 })}>
        long-press the map
      </button>
      <button type="button" onClick={onPan}>
        pan the map
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

// Where the map is centred, as "lat,lon".
const mapPoint = async (expected: string) =>
  waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-point", expected));
const locate = (name: RegExp) => screen.findByRole("button", { name });

describe("the app shell", () => {
  it("has a main region named for screen readers", async () => {
    renderApp("/");

    expect(await screen.findByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Pulse" })).toBeInTheDocument();
  });

  it("shows no coordinates: the pin on the map says where", async () => {
    renderApp("/?at=60.17000,24.95000");
    await mapPoint("60.17,24.95");

    expect(screen.queryByText(/60\.17/)).not.toBeInTheDocument();
  });
});

describe("where the app is looking", () => {
  it("starts at the Region's centre when nothing is known", async () => {
    renderApp("/");

    await mapPoint("60.225,24.85");
  });

  it("starts at the point remembered on the device", async () => {
    renderApp("/", fakePlatform({ stored: "60.16900,24.93164" }).platform);

    await mapPoint("60.169,24.93164");
  });

  it("lets the point in the URL win, so a shared link shows the same place", async () => {
    renderApp("/?at=60.17000,24.95000", fakePlatform({ stored: "60.16900,24.93164" }).platform);

    await mapPoint("60.17,24.95");
  });

  it("ignores a malformed point in the URL", async () => {
    renderApp("/?at=Töölö");

    await mapPoint("60.225,24.85");
  });

  it("moves the point where the map is long-pressed, into the URL and onto the device", async () => {
    const { platform, storage } = fakePlatform();
    const history = renderApp("/", platform);

    await userEvent.click(await screen.findByRole("button", { name: "long-press the map" }));

    await mapPoint("60.2,24.9");
    expect(history.location.search).toContain("at=60.20000%2C24.90000");
    expect(storage.get("point")).toBe("60.20000,24.90000");
  });
});

describe("the locate button", () => {
  it("goes to the device's location on the first tap, into the URL and onto the device", async () => {
    const { platform, storage, watching } = fakePlatform({ location: KAMPPI });
    const history = renderApp("/", platform);

    await userEvent.click(await locate(/^Go to my location$/));

    await mapPoint("60.169,24.93164");
    expect(history.location.search).toContain("at=60.16900%2C24.93164");
    expect(storage.get("point")).toBe("60.16900,24.93164");
    expect(watching.active).toBe(false);
  });

  it("follows on the second tap, and stops on the third", async () => {
    const { platform, watching } = fakePlatform({ location: KAMPPI });
    renderApp("/", platform);

    await userEvent.click(await locate(/^Go to my location$/));
    await userEvent.click(await locate(/^Follow my location$/));
    const following = await locate(/^Following your location$/);
    expect(following).toHaveAttribute("aria-pressed", "true");
    act(() => watching.onFix?.({ lat: 60.17, lon: 24.94 }));
    await mapPoint("60.17,24.94");

    await userEvent.click(following);
    expect(watching.active).toBe(false);
    expect(await locate(/^Go to my location$/)).toHaveAttribute("aria-pressed", "false");
  });

  it("stops following when the map is panned or a place is chosen by hand", async () => {
    const { platform, watching } = fakePlatform({ location: KAMPPI });
    renderApp("/", platform);
    const follow = async () => {
      await userEvent.click(await locate(/^Go to my location$/));
      await userEvent.click(await locate(/^Follow my location$/));
      expect(watching.active).toBe(true);
    };

    await follow();
    await userEvent.click(screen.getByRole("button", { name: "pan the map" }));
    expect(watching.active).toBe(false);

    await follow();
    await userEvent.click(screen.getByRole("button", { name: "long-press the map" }));
    expect(watching.active).toBe(false);
    await mapPoint("60.2,24.9");
  });

  it("explains a refused permission and stays where it was", async () => {
    renderApp("/?at=60.17000,24.95000", fakePlatform({ location: "denied" }).platform);

    await userEvent.click(await locate(/^Go to my location$/));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location is off");
    await mapPoint("60.17,24.95");
  });

  it("stops following and explains when location is refused while following", async () => {
    const { platform, watching } = fakePlatform({ location: KAMPPI });
    renderApp("/", platform);

    await userEvent.click(await locate(/^Go to my location$/));
    await userEvent.click(await locate(/^Follow my location$/));
    act(() => watching.onError?.(new LocationError("denied")));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location is off");
    expect(watching.active).toBe(false);
  });
});

describe("the bottom sheet", () => {
  it("is always there, titled, with the controls in it", async () => {
    renderApp("/");
    const sheet = await screen.findByRole("region", { name: "Around this point" });

    expect(sheet).toContainElement(await locate(/^Go to my location$/));
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
