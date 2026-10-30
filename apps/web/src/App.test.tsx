import type { Event, Region } from "@pulse/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  PointMap: ({ point, onLongPress, onPan, onMapClick, pins, renderPin, popup }: PointMapProps) => (
    <div data-testid="map" data-point={point ? `${point.lat},${point.lon}` : ""}>
      {pins.map((pin) => (
        <div key={pin.key}>{renderPin(pin)}</div>
      ))}
      {popup && <div data-testid="popup">{popup.content}</div>}
      <button type="button" onClick={onMapClick}>
        tap empty map
      </button>
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
// What /v0/events answers, set per test, and the queries it was asked.
let events: Event[] = [];
const eventQueries: URLSearchParams[] = [];
const server = setupServer(
  http.get("*/v0/regions", () => HttpResponse.json({ regions: [region] })),
  http.get("*/v0/events", ({ request }) => {
    eventQueries.push(new URL(request.url).searchParams);
    return HttpResponse.json({ events });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  events = [];
  eventQueries.length = 0;
});
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

const anEvent = (id: string, patch: Partial<Event> = {}): Event => ({
  id,
  kind: "works",
  layers: ["area"],
  title: { en: `Works ${id}` },
  where: { geometry: { type: "Point", coordinates: [24.95, 60.171] }, precision: "area" },
  when: { start: "2026-10-01T00:00:00+03:00" },
  severity: "minor",
  mainlyAffected: "drivers",
  noticeable: [],
  status: "active",
  sources: [{ name: "City", id, updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0,
  updatedAt: "2026-10-01T00:00:00+03:00",
  ...patch,
});

describe("Events on the map", () => {
  it("shows what's going on right now near the point, by default", async () => {
    events = [anEvent("a")];
    renderApp("/?at=60.17000,24.95000");

    expect(await screen.findByRole("button", { name: "Works a, minor" })).toBeInTheDocument();
    expect(eventQueries.at(-1)?.get("layer")).toBe("now");
    expect(eventQueries.at(-1)?.get("near")).toBe("60.17,24.95,1000");
  });

  it("switches to the next 14 days, kept in the URL", async () => {
    const history = renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("radio", { name: "14 days" }));

    await waitFor(() => expect(eventQueries.at(-1)?.get("layer")).toBeNull());
    const query = eventQueries.at(-1)!;
    expect(query.get("near")).toBe("60.17,24.95,1000");
    expect(query.get("status")).toBe("active,upcoming,resolved");
    expect(new Date(query.get("to")!).getTime() - new Date(query.get("from")!).getTime()).toBe(14 * 86_400_000);
    expect(history.location.search).toContain("time=14d");
    expect(screen.getByRole("radio", { name: "14 days" })).toBeChecked();
  });

  it("doesn't pin a region-wide notice", async () => {
    events = [anEvent("here"), anEvent("everywhere", { where: { geometry: { type: "Point", coordinates: [24.9, 60.2] }, precision: "vague" } })];
    renderApp("/?at=60.17000,24.95000");

    expect(await screen.findByRole("button", { name: "Works here, minor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Works everywhere, minor" })).not.toBeInTheDocument();
  });

  it("selects an Event when its pin is tapped, kept in the URL", async () => {
    events = [anEvent("a")];
    const history = renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "Works a, minor" }));

    await waitFor(() => expect(history.location.search).toContain("event=a"));
    expect(screen.getByRole("button", { name: "Works a, minor" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the Event card", () => {
  const open = async (event: Event) => {
    events = [event];
    const history = renderApp("/?at=60.17000,24.95000");
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^${textOf(event)},`) }));
    return { history, card: await within(await screen.findByTestId("popup")).findByRole("article") };
  };
  const textOf = (event: Event) => event.title.en!;

  it("pops up from the pin, saying who it affects first", async () => {
    const { card } = await open(anEvent("a", { mainlyAffected: "pedestrians", severity: "consider" }));

    expect(card).toHaveAccessibleName("Works a");
    expect(within(card).getAllByText(/./)[0]).toHaveTextContent("Pedestrians");
    expect(card).toHaveTextContent("Worth considering");
  });

  it("says plainly when it isn't known yet who it affects", async () => {
    const { card } = await open(anEvent("a", { mainlyAffected: "unknown" }));

    expect(card).toHaveTextContent("Not sure yet who this affects");
  });

  it("says when, why and how", async () => {
    const { card } = await open(
      anEvent("a", { when: { start: "2026-10-01T07:00:00+03:00" }, workType: "water_sewer", noticeable: ["noise", "blocked"] }),
    );

    expect(card).toHaveTextContent("Ongoing");
    expect(card).toHaveTextContent("Water and sewer works");
    expect(card).toHaveTextContent("Noisy");
    expect(card).toHaveTextContent("Blocks the way");
  });

  it("gives the kind of Event as the why when there's no kind of work", async () => {
    const { card } = await open(anEvent("a", { kind: "public_event" }));

    expect(card).toHaveTextContent("Public event");
  });

  it("moves to another pin when that one is tapped", async () => {
    events = [anEvent("a"), anEvent("b")];
    renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "Works a, minor" }));
    await userEvent.click(screen.getByRole("button", { name: "Works b, minor" }));

    expect(await screen.findByRole("article", { name: "Works b" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Works a" })).not.toBeInTheDocument();
  });

  it("closes with its close button, Escape, or a tap on empty map, and leaves the URL", async () => {
    for (const close of [
      () => userEvent.click(screen.getByRole("button", { name: "Close" })),
      () => userEvent.keyboard("{Escape}"),
      () => userEvent.click(screen.getByRole("button", { name: "tap empty map" })),
    ]) {
      const { history } = await open(anEvent("a"));
      await close();
      expect(screen.queryByRole("article")).not.toBeInTheDocument();
      expect(history.location.search).not.toContain("event=");
      cleanup();
    }
  });

  it("moves focus into the card, and back to the pin when it closes", async () => {
    await open(anEvent("a"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Works a" })).toHaveFocus());

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Works a, minor" })).toHaveFocus());
  });

  it("opens from a link with the Event in it", async () => {
    events = [anEvent("a")];
    renderApp("/?at=60.17000,24.95000&event=a");

    expect(await screen.findByRole("article", { name: "Works a" })).toBeInTheDocument();
  });

  it("isn't in the bottom sheet", async () => {
    await open(anEvent("a"));

    expect(screen.getByRole("region", { name: "Map controls" })).not.toContainElement(screen.getByRole("article"));
  });
});

describe("the status chip", () => {
  it("says all clear when nothing is going on", async () => {
    renderApp("/?at=60.17000,24.95000");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All clear right now"));
  });

  it("counts what's going on, and names the major ones", async () => {
    events = [anEvent("a"), anEvent("b", { severity: "major" })];
    renderApp("/?at=60.17000,24.95000");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 things going on near you · 1 major"));
  });

  it("speaks of the next two weeks on 14 days", async () => {
    events = [anEvent("a")];
    renderApp("/?at=60.17000,24.95000&time=14d");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 thing around here in the next 2 weeks"));
  });

  it("says when Pulse can't be reached", async () => {
    server.use(http.get("*/v0/events", () => new HttpResponse(null, { status: 503 })));
    renderApp("/?at=60.17000,24.95000");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Can't reach Pulse right now"), { timeout: 3000 });
  });
});

describe("the bottom sheet", () => {
  it("is always there, with the controls and no Events", async () => {
    events = [anEvent("a")];
    renderApp("/?at=60.17000,24.95000");
    const sheet = await screen.findByRole("region", { name: "Map controls" });

    expect(sheet).toContainElement(await locate(/^Go to my location$/));
    expect(sheet).toContainElement(screen.getByRole("radio", { name: "Now" }));
    expect(sheet).not.toHaveTextContent("Works a");
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
