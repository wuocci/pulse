import type { Event, GeocodeResult, Region, Trip } from "@pulse/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { PointMapProps } from "./map/PointMap.tsx";
import { type DeviceLocation, type LatLon, LocationError, type Platform } from "./platform.tsx";

// The real map draws with WebGL, which jsdom lacks: this one shows what it was given, and can be long-pressed
// and panned. Pins at the very same spot are drawn as one group, as the real map does at any zoom.
vi.mock("./map/PointMap.tsx", () => ({
  PointMap: ({ point, onLongPress, onPan, onMapClick, pins, renderPin, renderGroup, radiusM, onShapeClick, onShapeHover, emphasised, popup, route, destination, parking, focus, reveal }: PointMapProps) => (
    <div
      data-testid="map"
      data-point={point ? `${point.lat},${point.lon}` : ""}
      data-radius={radiusM ?? ""}
      data-emphasised={emphasised?.join(",") ?? ""}
      data-reveal={reveal ?? ""}
      data-route={route?.map((leg) => leg.mode).join(",") ?? ""}
      data-parking={parking ? `${parking.picks.length} picks, ${parking.places.length} places` : ""}
      data-destination={destination ? `${destination.name} ${destination.lat},${destination.lon}` : ""}
      data-focus={!focus ? "" : "back" in focus ? "back" : `${focus.lat},${focus.lon}`}
    >
      {parking && (
        <ul aria-label="parking spots on the map">
          {parking.places.map((place, i) => (
            <li key={i}>{place.label}</li>
          ))}
        </ul>
      )}
      {[
        ...pins
          .reduce((groups, pin) => {
            const spot = renderGroup && pin.key !== popup?.pinKey ? pin.lngLat.join(",") : pin.key;
            return groups.set(spot, [...(groups.get(spot) ?? []), pin]);
          }, new Map<string, typeof pins>())
          .values(),
      ].map(([first, ...rest]) =>
        rest.length ? <div key={first!.key}>{renderGroup!([first!, ...rest], undefined)}</div> : <div key={first!.key}>{renderPin(first!)}</div>,
      )}
      {popup && <div data-testid="popup">{popup.content}</div>}
      <button type="button" onClick={onMapClick}>
        tap empty map
      </button>
      {onShapeClick &&
        pins.map((pin) => (
          <button key={pin.key} type="button" onClick={() => onShapeClick(pin.event.id)} onMouseEnter={() => onShapeHover?.({ eventId: pin.event.id, pinKey: pin.key })} onMouseLeave={() => onShapeHover?.(undefined)}>
            tap the shape of {pin.event.id}
          </button>
        ))}
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
// What /v0/events answers, set per test, and the queries it was asked: what's upcoming to Coming up's query, the
// rest to the query for what's going on.
let events: Event[] = [];
const eventQueries: URLSearchParams[] = [];
// What /v0/geocode answers, set per test, and the queries it was asked.
let places: GeocodeResult[] | "off" = [];
const geocodeQueries: URLSearchParams[] = [];
// What /v0/trips answers, set per test, and the queries it was asked.
let trip: Trip = { events: [], plans: [] };
const tripQueries: URLSearchParams[] = [];
const server = setupServer(
  http.get("*/v0/trips", ({ request }) => {
    tripQueries.push(new URL(request.url).searchParams);
    return HttpResponse.json(trip);
  }),
  http.get("*/v0/geocode", ({ request }) => {
    geocodeQueries.push(new URL(request.url).searchParams);
    return places === "off" ? HttpResponse.json({ message: "Address search is off" }, { status: 503 }) : HttpResponse.json({ results: places });
  }),
  http.get("*/v0/regions", () => HttpResponse.json({ regions: [region] })),
  http.get("*/v0/events", ({ request }) => {
    const query = new URL(request.url).searchParams;
    eventQueries.push(query);
    const upcoming = query.get("status") === "upcoming";
    return HttpResponse.json({ events: events.filter((e) => (e.status === "upcoming") === upcoming) });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  events = [];
  eventQueries.length = 0;
  places = [];
  geocodeQueries.length = 0;
  trip = { events: [], plans: [] };
  tripQueries.length = 0;
});
afterAll(() => server.close());

const KAMPPI: LatLon = { lat: 60.169, lon: 24.93164 };

// A device whose location and storage the test controls.
function fakePlatform({ stored, location, allowed = true }: { stored?: string; location?: LatLon | "denied"; allowed?: boolean } = {}) {
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
    allowed: async () => allowed,
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
// The last query for what's going on at the time, and for what's coming up.
const nowQuery = () => eventQueries.filter((q) => q.get("status") !== "upcoming").at(-1);
const soonQuery = () => eventQueries.filter((q) => q.get("status") === "upcoming").at(-1);

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
  // Only what's worth considering or major is shown.
  severity: "consider",
  mainlyAffected: "drivers",
  noticeable: [],
  status: "active",
  sources: [{ name: "City", id, updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0,
  updatedAt: "2026-10-01T00:00:00+03:00",
  ...patch,
});

// Somewhere else than anEvent's own spot, so the two aren't drawn as one group.
const APART: Partial<Event> = { where: { geometry: { type: "Point", coordinates: [24.96, 60.172] }, precision: "area" } };

describe("Events on the map", () => {
  it("shows what's going on right now near the point, by default", async () => {
    events = [anEvent("a")];
    renderApp("/?at=60.17000,24.95000");

    expect(await screen.findByRole("button", { name: "Works a, Drivers, some disruption" })).toBeInTheDocument();
    expect(nowQuery()?.get("layer")).toBe("now");
    expect(nowQuery()?.get("near")).toBe("60.17,24.95,1000");
    expect(screen.getByTestId("map")).toHaveAttribute("data-radius", "1000");
  });

  it("rings a pin you'd notice on site, and says how in its label", async () => {
    events = [anEvent("dig", { noticeable: ["noise", "blocked"] }), anEvent("quiet", APART)];
    renderApp("/?at=60.17000,24.95000");

    const dig = await screen.findByRole("button", { name: "Works dig, Drivers, some disruption, noise, blocked way" });
    expect(dig).toHaveClass("outline-2");
    expect(screen.getByRole("button", { name: "Works quiet, Drivers, some disruption" })).not.toHaveClass("outline-2");
  });

  it("leaves a line's alert it can't place out of My area: it's for Trips, not the whole Region", async () => {
    const vague = { geometry: { type: "Point" as const, coordinates: [24.9, 60.2] }, precision: "vague" as const };
    events = [
      anEvent("here"),
      anEvent("strike", { where: vague, title: { en: "Strike: no buses" } }),
      anEvent("majvik", { where: { ...vague, lines: ["HSL:9841"] }, title: { en: "Majvik stop closed" } }),
    ];
    renderApp("/?at=60.17000,24.95000");

    const list = await screen.findByRole("list", { name: "In your way" });
    expect(await within(list).findByRole("button", { name: /^Strike: no buses/ })).toBeInTheDocument();
    expect(screen.queryByText("Majvik stop closed")).not.toBeInTheDocument();
  });

  it("lists region-wide notices first in your way, unpinned, and opens their card from there", async () => {
    const vague = { geometry: { type: "Point" as const, coordinates: [24.9, 60.2] }, precision: "vague" as const };
    events = [anEvent("here"), anEvent("metro", { where: vague, title: { en: "Metro: no service" } }), anEvent("bridge", { where: vague, title: { en: "Bridge closed" } })];
    const history = renderApp("/?at=60.17000,24.95000");

    const list = await screen.findByRole("list", { name: "In your way" });
    await waitFor(() => expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Metro: no service/),
      expect.stringMatching(/^Bridge closed/),
      expect.stringMatching(/^Works here.*110 m/),
    ]));
    await userEvent.click(within(list).getByRole("button", { name: /^Metro: no service/ }));

    await waitFor(() => expect(history.location.search).toContain("event=metro"));
    expect(screen.getByRole("heading", { name: "Metro: no service" })).toHaveFocus();
    expect(screen.getByRole("article")).toHaveTextContent("WhereRoughly: the Source doesn't say exactly where");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(history.location.search).not.toContain("event="));
  });

  it("draws pins at one spot as one group, and opens a chooser from it", async () => {
    const stop = { geometry: { type: "Point" as const, coordinates: [24.95, 60.171] }, precision: "exact" as const };
    events = [anEvent("a", { where: stop }), anEvent("b", { where: stop, severity: "major" }), anEvent("elsewhere", { where: { ...stop, geometry: { type: "Point", coordinates: [24.96, 60.172] } } })];
    const history = renderApp("/?at=60.17000,24.95000");

    const group = await screen.findByRole("button", { name: "2 things at this spot" });
    expect(group).toHaveTextContent("2");
    expect(group).toHaveClass("bg-red-600");
    expect(screen.getByRole("button", { name: "Works elsewhere, Drivers, some disruption" })).toBeInTheDocument();

    await userEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Works b" }));

    await waitFor(() => expect(history.location.search).toContain("event=b"));
    expect(await screen.findByRole("article", { name: "Works b" })).toBeInTheDocument();
  });

  it("opens an Event's card from a tap on its area or line, and draws that shape bold", async () => {
    events = [anEvent("dig"), anEvent("road", APART)];
    const history = renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "tap the shape of road" }));

    await waitFor(() => expect(history.location.search).toContain("event=road"));
    expect(within(await screen.findByRole("article")).getByRole("heading", { name: "Works road" })).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-emphasised", "road");
  });

  it("explains its marks behind ⓘ, and closes it on Escape", async () => {
    renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "What the map shows" }));
    const legend = screen.getByRole("region", { name: "What the map shows" });
    expect(legend).toHaveTextContent("Amber: some disruption");
    expect(legend).toHaveTextContent("Dark ring: you'd notice it on site");
    expect(legend).toHaveTextContent("Shaded area: where the works, closure or event is");
    expect(legend).toHaveTextContent("Dashed circle: how far the map looks around the place, 1 km.");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "What the map shows" })).not.toBeInTheDocument();
  });

  it("shows on each pin who it affects, or else what kind of Event it is", async () => {
    events = [anEvent("a"), anEvent("b", { mainlyAffected: "unknown", ...APART })];
    renderApp("/?at=60.17000,24.95000");

    const drivers = await screen.findByRole("button", { name: "Works a, Drivers, some disruption" });
    expect(drivers.querySelector(".lucide-car")).toBeInTheDocument();
    expect(drivers.querySelector(".lucide-construction")).not.toBeInTheDocument();
    // Not known yet who: what it is says more than a question mark.
    expect(screen.getByRole("button", { name: "Works b, Not sure yet who this affects, some disruption" }).querySelector(".lucide-construction")).toBeInTheDocument();
  });

  it("doesn't pin a region-wide notice", async () => {
    events = [anEvent("here"), anEvent("everywhere", { where: { geometry: { type: "Point", coordinates: [24.9, 60.2] }, precision: "vague" } })];
    renderApp("/?at=60.17000,24.95000");

    expect(await screen.findByRole("button", { name: "Works here, Drivers, some disruption" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Works everywhere, Drivers, some disruption" })).not.toBeInTheDocument();
  });

  it("selects an Event when its pin is tapped, kept in the URL", async () => {
    events = [anEvent("a")];
    const history = renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "Works a, Drivers, some disruption" }));

    await waitFor(() => expect(history.location.search).toContain("event=a"));
    expect(screen.getByRole("button", { name: "Works a, Drivers, some disruption" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the Event card", () => {
  const open = async (event: Event) => {
    events = [event];
    const history = renderApp("/?at=60.17000,24.95000");
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^${textOf(event)},`) }));
    return { history, card: await screen.findByRole("article") };
  };
  const textOf = (event: Event) => event.title.en!;

  it("opens from the pin with what it is and how much it gets in the way", async () => {
    const { card } = await open(anEvent("a", { title: { en: "Bridge closed · Hopeasalmentien silta" }, severity: "consider" }));

    expect(card).toHaveAccessibleName("Bridge closed");
    expect(within(card).getByRole("heading", { name: "Bridge closed" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Hopeasalmentien silta");
    expect(card).toHaveTextContent("Some disruption");
  });

  it("names a dig by its kind of work, in plain words", async () => {
    const { card } = await open(anEvent("a", { title: { en: "Works a · Messitytönkatu 2" }, workType: "water_sewer" }));

    expect(card).toHaveAccessibleName("Water and sewer dig");
    expect(card).toHaveTextContent("Messitytönkatu 2");
  });

  it("lays out when, who and what you'd see as a table, in Finnish dates", async () => {
    const { card } = await open(
      anEvent("a", { when: { start: "2026-10-01T07:00:00+03:00", end: "2027-12-31T23:59:59+02:00" }, mainlyAffected: "pedestrians", noticeable: ["noise", "blocked"] }),
    );
    const row = (name: string) => within(card).getByRole("rowheader", { name }).closest("tr");

    expect(row("When")).toHaveTextContent("Now – 31.12.2027");
    expect(row("Affects")).toHaveTextContent("Pedestrians");
    expect(row("You'd see")).toHaveTextContent("Noise · Blocked way");
  });

  it("leaves out a row with nothing to say, like who it affects when that isn't known", async () => {
    const { card } = await open(anEvent("a", { mainlyAffected: "unknown" }));

    expect(within(card).getAllByRole("rowheader").map((th) => th.textContent)).toEqual(["When"]);
    expect(card).not.toHaveTextContent("Not sure yet");
  });

  it("moves to another pin when that one is tapped", async () => {
    events = [anEvent("a"), anEvent("b", APART)];
    renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "Works a, Drivers, some disruption" }));
    await userEvent.click(screen.getByRole("button", { name: "Works b, Drivers, some disruption" }));

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

    await waitFor(() => expect(screen.getByRole("button", { name: "Works a, Drivers, some disruption" })).toHaveFocus());
  });

  it("opens from a link with the Event in it", async () => {
    events = [anEvent("a")];
    renderApp("/?at=60.17000,24.95000&event=a");

    expect(await screen.findByRole("article", { name: "Works a" })).toBeInTheDocument();
  });

  it("opens below the map in place of the sections, and the map centres on it", async () => {
    await open(anEvent("a"));

    expect(screen.queryByRole("list", { name: "In your way" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-focus", "60.171,24.95"));
  });

  it("puts the map back where it was when the card closes", async () => {
    await open(anEvent("a"));
    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-focus", "60.171,24.95"));

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-focus", "back"));
  });

  it("names a transit alert's lines and stops", async () => {
    const { card } = await open(
      anEvent("a", {
        mainlyAffected: "transit",
        where: { ...anEvent("a").where, lines: ["HSL:1805"], stops: ["HSL:1", "HSL:2"], lineNames: ["805"], stopNames: ["Klaavuntie", "Juorumäki"] },
      }),
    );

    expect(within(card).getByRole("rowheader", { name: "Line" }).closest("tr")).toHaveTextContent("805");
    expect(within(card).getByRole("rowheader", { name: "Stops" }).closest("tr")).toHaveTextContent("Klaavuntie and Juorumäki");
    expect(within(card).queryByRole("rowheader", { name: "Where" })).not.toBeInTheDocument();
  });

  it("links the Source at the bottom, with its own title, text and terms under More", async () => {
    const { card } = await open(
      anEvent("a", {
        originalText: { en: "Water pipe repair. Lane closed." },
        sources: [{ name: "City of Helsinki", id: "a", url: "https://example.fi/a", updatedAt: "2026-10-01T09:00:00+03:00", license: "CC BY 4.0" }],
      }),
    );
    const more = within(card).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(card).not.toHaveTextContent("Water pipe repair");

    await userEvent.click(more);

    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveTextContent("The Source's titleWorks a");
    expect(card).toHaveTextContent("Water pipe repair. Lane closed.");
    expect(card).toHaveTextContent("City of Helsinki · CC BY 4.0");
    expect(within(card).getByRole("link", { name: "Open at City of Helsinki" })).toHaveAttribute("href", "https://example.fi/a");
  });

});

describe("the summary line", () => {
  it("says nothing is out of the ordinary when nothing is in your way, never that all is clear", async () => {
    events = [anEvent("small", { severity: "minor", noticeable: ["noise"] })];
    renderApp("/?at=60.17000,24.95000");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nothing out of the ordinary right now"));
    expect(screen.queryByText(/all clear/i)).not.toBeInTheDocument();
  });

  it("counts what's in your way, and names the major ones", async () => {
    events = [anEvent("a"), anEvent("b", { severity: "major" })];
    renderApp("/?at=60.17000,24.95000");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^2 things in your way · 1 major$/));
  });

  it("says near which place, when the place has a name", async () => {
    events = [anEvent("a")];
    renderApp("/", fakePlatform({ location: { lat: 60.17, lon: 24.95 } }).platform);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 thing in your way near Current location"));
  });

  it("says it's looking around until it knows", async () => {
    server.use(http.get("*/v0/events", async () => {
      await delay("infinite");
      return HttpResponse.json({ events: [] });
    }));
    renderApp("/?at=60.17000,24.95000");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Looking around…"));
  });

  it("says when Pulse can't be reached", async () => {
    server.use(http.get("*/v0/events", () => new HttpResponse(null, { status: 503 })));
    renderApp("/?at=60.17000,24.95000");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Can't reach Pulse right now"), { timeout: 3000 });
  });
});

describe("the time", () => {
  const group = () => screen.findByRole("group", { name: "When" });

  it("starts on now", async () => {
    renderApp("/?at=60.17000,24.95000");

    expect(within(await group()).getByRole("button", { name: "Now" })).toHaveAttribute("aria-pressed", "true");
    expect(within(await group()).queryByRole("button", { name: "Back to now" })).not.toBeInTheDocument();
  });

  it("shows what's going on at a picked time, kept in the URL, and goes back to now", async () => {
    events = [anEvent("a")];
    const history = renderApp("/?at=60.17000,24.95000");

    fireEvent.change(within(await group()).getByLabelText("Pick a time"), { target: { value: "2026-12-12T18:00" } });

    await waitFor(() => expect(nowQuery()?.get("layer")).toBeNull());
    const moment = new Date("2026-12-12T18:00").toISOString();
    expect(nowQuery()?.get("from")).toBe(moment);
    expect(nowQuery()?.get("to")).toBe(moment);
    expect(history.location.search).toContain("time=2026-12-12T18%3A00");
    expect(within(await group()).getByRole("button", { name: "Now" })).toHaveAttribute("aria-pressed", "false");
    expect(within(await group()).getByLabelText("At 12.12.2026 18.00")).toBeInTheDocument();

    await userEvent.click(within(await group()).getByRole("button", { name: "Back to now" }));
    await waitFor(() => expect(history.location.search).not.toContain("time="));
    expect(nowQuery()?.get("layer")).toBe("now");
  });

  it("opens on the URL's time, and speaks of that time", async () => {
    renderApp("/?at=60.17000,24.95000&time=2026-12-12T18:00");

    expect(within(await group()).getByLabelText("At 12.12.2026 18.00")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nothing out of the ordinary at that time"));
  });
});

describe("Home's sections", () => {
  const at = (id: string, lat: number, patch: Partial<Event> = {}) =>
    anEvent(id, { where: { geometry: { type: "Point", coordinates: [24.95, lat] }, precision: "area" }, ...patch });
  const list = async () => within(await screen.findByRole("list", { name: "In your way", hidden: true }));

  it("lists what's in your way nearest first, once, with who and how far, led by when it ends", async () => {
    events = [
      at("far", 60.19),
      anEvent("stops", { where: { geometry: { type: "MultiPoint", coordinates: [[24.95, 60.18], [24.95, 60.172]] }, precision: "exact" } }),
      at("near", 60.171, { mainlyAffected: "pedestrians" }),
    ];
    renderApp("/?at=60.17000,24.95000");
    const rows = await (await list()).findAllByRole("button");

    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Works near.*Pedestrians · 110 m/),
      expect.stringMatching(/^Works stops.*220 m/),
      expect.stringMatching(/^Works far.*2\.2 km/),
    ]);
    expect(within(rows[0]!).getByText("No end date")).toBeInTheDocument();
  });

  it("opens an Event's card, like its pin, and marks it in the list", async () => {
    events = [at("a", 60.171), at("b", 60.172)];
    const history = renderApp("/?at=60.17000,24.95000");
    const row = await (await list()).findByRole("button", { name: /^Works b/ });

    await userEvent.click(row);

    expect(await screen.findByRole("article", { name: "Works b" })).toBeInTheDocument();
    expect(history.location.search).toContain("event=b");
    expect(row).toHaveAttribute("aria-current", "true");
    expect((await list()).getByRole("button", { name: /^Works a/, hidden: true })).not.toHaveAttribute("aria-current");
  });

  it("points out an Event's shape on the map while it's hovered or focused in the list", async () => {
    events = [at("a", 60.171), at("b", 60.172)];
    renderApp("/?at=60.17000,24.95000");
    const row = await (await list()).findByRole("button", { name: /^Works b/ });
    const map = screen.getByTestId("map");

    await userEvent.hover(row);
    expect(map).toHaveAttribute("data-emphasised", "b");
    await userEvent.unhover(row);
    expect(map).toHaveAttribute("data-emphasised", "");

    act(() => row.focus());
    expect(map).toHaveAttribute("data-emphasised", "b");
  });

  it("glances at an Event while its pin is pointed at on the map, and opens its card from there", async () => {
    events = [at("a", 60.171), at("b", 60.172)];
    renderApp("/?at=60.17000,24.95000");
    const pin = await within(await screen.findByTestId("map")).findByRole("button", { name: /^Works b,/ });

    await userEvent.hover(pin);
    const glance = within(screen.getByTestId("popup")).getByRole("button", { name: /^Works b/ });
    expect(screen.getByTestId("map")).toHaveAttribute("data-emphasised", "b");
    expect((await list()).getByRole("button", { name: /^Works b/ })).not.toHaveAttribute("aria-current");

    await userEvent.click(glance);
    expect(await screen.findByRole("article", { name: "Works b" })).toBeInTheDocument();
    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();
  });

  it("puts a glance away a moment after the pointer leaves, or with Escape", async () => {
    events = [at("a", 60.171), at("b", 60.172)];
    renderApp("/?at=60.17000,24.95000");
    const pin = await within(await screen.findByTestId("map")).findByRole("button", { name: /^Works b,/ });

    await userEvent.hover(pin);
    await userEvent.unhover(pin);
    expect(screen.getByTestId("popup")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("popup")).not.toBeInTheDocument());

    await userEvent.hover(pin);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();
  });

  it("glances at an Event while its area is pointed at, leaving the list's tab as it is", async () => {
    events = [at("big", 60.171), at("loud", 60.172, { severity: "minor", noticeable: ["noise"] })];
    renderApp("/?at=60.17000,24.95000");
    const shape = await screen.findByRole("button", { name: "tap the shape of loud" });
    expect(await screen.findByRole("tab", { name: "In your way 1" })).toHaveAttribute("aria-selected", "true");

    await userEvent.hover(shape);

    expect(within(screen.getByTestId("popup")).getByRole("button", { name: /^Works loud/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "In your way 1" })).toHaveAttribute("aria-selected", "true");
  });

  it("asks the map to show the Event a row is pointed at, and stops when it isn't", async () => {
    events = [at("a", 60.171), at("b", 60.172)];
    renderApp("/?at=60.17000,24.95000");
    const row = await (await list()).findByRole("button", { name: /^Works b/ });
    const map = screen.getByTestId("map");

    await userEvent.hover(row);
    expect(map).toHaveAttribute("data-reveal", "b");
    await userEvent.unhover(row);
    expect(map).toHaveAttribute("data-reveal", "");
  });

  it("marks in the list an Event chosen on the map", async () => {
    events = [at("a", 60.171), at("b", 60.172)];
    renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "tap the shape of b" }));

    await waitFor(async () => expect((await list()).getByRole("button", { name: /^Works b/, hidden: true })).toHaveAttribute("aria-current", "true"));
  });

  it("gives focus back to the row a card was opened from", async () => {
    events = [at("a", 60.171), at("b", 60.172)];
    renderApp("/?at=60.17000,24.95000");
    const row = await (await list()).findByRole("button", { name: /^Works b/ });

    await userEvent.click(row);
    await screen.findByRole("article", { name: "Works b" });
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(row).toHaveFocus());
  });

  it("puts the rest you'd notice on site around you, and leaves out what's minor and quiet, or in nobody's way", async () => {
    events = [
      at("big", 60.171),
      at("loud", 60.172, { severity: "minor", noticeable: ["noise"] }),
      at("note", 60.173, { severity: "info" }),
      at("sea", 60.174, { mainlyAffected: "nobody" }),
    ];
    renderApp("/?at=60.17000,24.95000");

    expect(await (await list()).findByRole("button", { name: /^Works big/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Around you 1" }));
    const around = within(screen.getByRole("list", { name: "Around you" }));
    expect(around.getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringMatching(/^Works loud/)]);
    expect(screen.queryByText("Works note")).not.toBeInTheDocument();
    expect(screen.queryByText("Works sea")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Works note,/ })).not.toBeInTheDocument();
  });

  it("lists what starts in the next two weeks under Coming up, soonest first, and opens on the first tab with anything", async () => {
    events = [
      at("later", 60.171, { status: "upcoming", when: { start: "2026-11-20T08:00:00+02:00" } }),
      at("sooner", 60.172, { status: "upcoming", when: { start: "2026-11-12T08:00:00+02:00", end: "2026-11-14T16:00:00+02:00" } }),
    ];
    renderApp("/?at=60.17000,24.95000");

    expect(await screen.findByRole("tab", { name: "Coming up 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "In your way 0" })).toHaveAttribute("aria-selected", "false");
    const comingUp = within(screen.getByRole("list", { name: "Coming up" }));
    expect(comingUp.getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringMatching(/^Works sooner.*starts/), expect.stringMatching(/^Works later.*starts/)]);
    const query = soonQuery()!;
    expect(query.get("near")).toBe("60.17,24.95,1000");
    expect(new Date(query.get("to")!).getTime() - new Date(query.get("from")!).getTime()).toBe(14 * 86_400_000);

    await userEvent.click(screen.getByRole("tab", { name: "In your way 0" }));
    expect(screen.getByText("Nothing in your way")).toBeInTheDocument();
  });

  it("moves between the tabs with the arrow keys", async () => {
    events = [at("a", 60.171)];
    renderApp("/?at=60.17000,24.95000");
    const first = await screen.findByRole("tab", { name: "In your way 1" });

    act(() => first.focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Around you 0" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Around you 0" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Coming up 0" })).toHaveAttribute("aria-selected", "true");
  });

  it("leads with what a dig is, and where, in place of the Source's \"Excavation · street\"", async () => {
    events = [at("dig", 60.171, { title: { en: "Excavation · Arkadiankatu 2" }, workType: "water_sewer" })];
    renderApp("/?at=60.17000,24.95000");

    const row = await (await list()).findByRole("button", { name: /^Water and sewer dig/ });
    expect(row).toHaveTextContent(/^Water and sewer digArkadiankatu 2 · Drivers · 110 m/);
  });
});

describe("how Pulse looks", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });
  it("is like the phone until told otherwise, and keeps light or dark on the device", async () => {
    renderApp("/?at=60.17000,24.95000");
    await userEvent.click((await screen.findAllByRole("button", { name: "Appearance" }))[0]!);
    expect(screen.getByRole("radio", { name: "Like the phone" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("light");

    await userEvent.click(screen.getByRole("radio", { name: "Like the phone" }));
    expect(localStorage.getItem("theme")).toBeNull();
  });
});

describe("list or map on a phone", () => {
  const toggle = () => within(screen.getByRole("group", { name: "Show as" }));
  const shown = () => screen.findByRole("group", { name: "Show as" });

  it("starts on the list, and switches to the map and back", async () => {
    renderApp("/?at=60.17000,24.95000");

    await shown();
    expect(toggle().getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle().getByRole("button", { name: "Map" }));
    expect(toggle().getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle().getByRole("button", { name: "List" }));
    expect(toggle().getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  });

  it("goes back to the list with the card open when a pin is tapped on the map", async () => {
    events = [anEvent("a")];
    renderApp("/?at=60.17000,24.95000");

    await shown();
    await userEvent.click(toggle().getByRole("button", { name: "Map" }));
    await userEvent.click(await within(screen.getByTestId("map")).findByRole("button", { name: "Works a, Drivers, some disruption" }));

    expect(await screen.findByRole("article", { name: "Works a" })).toBeInTheDocument();
    expect(toggle().getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("where Home looks around", () => {
  const chip = () => screen.findByRole("button", { name: /^Near: / });

  it("starts at the device's location when it's allowed, and calls it so", async () => {
    renderApp("/", fakePlatform({ location: KAMPPI }).platform);

    await mapPoint("60.169,24.93164");
    expect(await chip()).toHaveTextContent("Near: Current location");
  });

  it("stays at a place chosen by hand last time, by its name", async () => {
    const { platform, storage } = fakePlatform({ stored: "60.17000,24.95000", location: KAMPPI });
    storage.set("place", JSON.stringify({ at: "60.17000,24.95000", name: "Kamppi" }));
    renderApp("/", platform);

    await waitFor(async () => expect(await chip()).toHaveTextContent("Near: Kamppi"));
    await mapPoint("60.17,24.95");
  });

  it("goes to the device's location from the chip", async () => {
    renderApp("/?at=60.17000,24.95000", fakePlatform({ location: KAMPPI, allowed: false }).platform);

    await userEvent.click(await chip());
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));

    await mapPoint("60.169,24.93164");
    expect(await chip()).toHaveTextContent("Near: Current location");
  });
});

describe("address search", () => {
  const MANSKU: GeocodeResult = { name: "Mannerheimintie 10", label: "Mannerheimintie 10, Helsinki", lat: 60.167679, lon: 24.94127 };
  const OOPPERA: GeocodeResult = { name: "Kansallisooppera", label: "Kansallisooppera, Helsinki", lat: 60.1826, lon: 24.9266 };
  const search = async () => {
    await userEvent.click(await screen.findByRole("button", { name: /^Near: / }));
    return screen.findByRole("combobox", { name: "Search for an address or place" });
  };

  it("opens from the place chip", async () => {
    renderApp("/?at=60.17000,24.95000");

    expect(await search()).toHaveFocus();
    expect(screen.getByRole("group", { name: "Where to look around" })).toContainElement(screen.getByRole("button", { name: "Use my location" }));
  });

  it("suggests places near the point as you type, in your language, and moves the map to the one you pick", async () => {
    places = [MANSKU, OOPPERA];
    const { platform, storage } = fakePlatform();
    renderApp("/?at=60.17000,24.95000", platform);

    await userEvent.type(await search(), "manner");
    const option = await screen.findByRole("option", { name: "Mannerheimintie 10, Helsinki" });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(Object.fromEntries(geocodeQueries.at(-1)!)).toEqual({ text: "manner", near: "60.17,24.95", lang: "en" });

    await userEvent.click(option);
    await mapPoint("60.16768,24.94127");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Near: / })).toHaveTextContent("Near: Mannerheimintie 10");
    expect(JSON.parse(storage.get("place")!)).toEqual({ at: "60.16768,24.94127", name: "Mannerheimintie 10" });
  });

  it("can be used with the keyboard alone", async () => {
    places = [MANSKU, OOPPERA];
    renderApp("/?at=60.17000,24.95000");
    const input = await search();

    await userEvent.type(input, "manner");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: /Kansallisooppera/ }).id);
    expect(screen.getByRole("option", { name: /Kansallisooppera/ })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{Enter}");
    await mapPoint("60.1826,24.9266");
  });

  it("closes the suggestions on Escape, then clears the text", async () => {
    places = [MANSKU];
    renderApp("/?at=60.17000,24.95000");
    const input = await search();

    await userEvent.type(input, "manner");
    await screen.findByRole("option");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(input).toHaveValue("manner");

    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });

  it("waits for a second letter before searching", async () => {
    renderApp("/?at=60.17000,24.95000");

    await userEvent.type(await search(), "m");
    await new Promise((r) => setTimeout(r, 400));

    expect(geocodeQueries).toHaveLength(0);
  });

  it("says when nothing matches, and when search isn't available", async () => {
    renderApp("/?at=60.17000,24.95000");
    const input = await search();

    await userEvent.type(input, "zzzz");
    // What a screen reader hears; the same words show under the field.
    const heard = (text: string) => screen.findByText(text, { ignore: "[aria-hidden=true]" });
    expect(await heard("No places found")).toBeInTheDocument();

    places = "off";
    await userEvent.type(input, "y");
    expect(await heard("Address search isn't available")).toBeInTheDocument();
  });
});

describe("Trip mode", () => {
  const PASILA: GeocodeResult = { name: "Pasila", label: "Pasila, Helsinki", lat: 60.1986, lon: 24.933 };
  const itinerary = (minutes: number, impact: Trip["plans"][number]["itineraries"][number]["impact"]) => ({
    start: "2026-10-31T12:00:00+02:00",
    end: "2026-10-31T12:30:00+02:00",
    durationS: minutes * 60,
    legs: [],
    eventIds: [],
    onTheWay: [],
    comingUp: [],
    impact,
  });
  const PLANNED: Trip = {
    events: [],
    plans: [
      { mode: "transit", itineraries: [itinerary(15, "consider"), itinerary(18, "none")] },
      { mode: "walk", itineraries: [] },
      { mode: "bike", itineraries: [itinerary(22, "none")] },
    ],
  };
  const toField = () => screen.findByRole("combobox", { name: "To" });
  const modes = () => screen.findByRole("group", { name: "Travel mode" });

  it("opens from Where to?, from where the pin is, and closes back to home", async () => {
    renderApp("/?at=60.17000,24.95000");

    await userEvent.click(await screen.findByRole("button", { name: "Where to?" }));
    expect(await toField()).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "From" })).toHaveAttribute("placeholder", "Where the pin is");
    expect(screen.queryByRole("button", { name: /^Near: / })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Where to?" })).toBeInTheDocument();
  });

  it("leaves now unless told when, and asks for the routes leaving then", async () => {
    trip = PLANNED;
    renderApp("/?at=60.17000,24.95000&trip=true&to=60.19000,24.94000&toName=Pasila");

    const when = within(await screen.findByRole("group", { name: "Leave when" }));
    expect(when.getByRole("button", { name: "Leave now" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(tripQueries.at(-1)?.has("departAt")).toBe(false));

    fireEvent.change(when.getByLabelText("Leave at…"), { target: { value: "2026-12-12T18:00" } });

    expect(await when.findByText("Leave 12.12.2026 18.00")).toBeInTheDocument();
    await waitFor(() => expect(tripQueries.at(-1)?.get("departAt")).toBe(new Date("2026-12-12T18:00").toISOString()));
  });

  it("plans every mode to the place picked, and shows each one's time and how much is in the way", async () => {
    places = [PASILA];
    trip = PLANNED;
    const history = renderApp("/?at=60.17000,24.95000&trip=true");

    await userEvent.type(await toField(), "pasila");
    await userEvent.click(await screen.findByRole("option", { name: "Pasila, Helsinki" }));

    const group = within(await modes());
    expect(await group.findByRole("radio", { name: "Public transport, 15 min, some disruption" })).toBeChecked();
    expect(group.getByRole("radio", { name: "Walk, no route" })).toBeInTheDocument();
    expect(group.getByRole("radio", { name: "Bike, 22 min" })).toBeInTheDocument();
    expect(Object.fromEntries(tripQueries.at(-1)!)).toEqual({ from: "60.17,24.95", to: "60.1986,24.933" });
    expect(history.location.search).toContain("to=60.19860%2C24.93300");
    expect(await toField()).toHaveValue("Pasila");
  });

  it("says a car's time is without traffic", async () => {
    trip = { events: [], plans: [...PLANNED.plans, { mode: "car", itineraries: [itinerary(16, "none")] }] };
    renderApp("/?at=60.17000,24.95000&trip=true&to=60.19860,24.93300&toName=Pasila&mode=car");

    const car = await within(await modes()).findByRole("radio", { name: "Car, 16 min without traffic" });
    expect(car.closest("label")).toHaveTextContent("~16 min");
    expect(car).toBeChecked();
  });

  it("keeps the chosen mode in the URL", async () => {
    trip = PLANNED;
    const history = renderApp("/?at=60.17000,24.95000&trip=true&to=60.19860,24.93300&toName=Pasila");

    await userEvent.click(await within(await modes()).findByRole("radio", { name: /^Bike/ }));

    expect(history.location.search).toContain("mode=bike");
    expect(within(await modes()).getByRole("radio", { name: /^Bike/ })).toBeChecked();
  });

  it("opens the same Trip from a shared link", async () => {
    trip = PLANNED;
    renderApp("/?at=60.17000,24.95000&trip=true&from=60.16000,24.94000&fromName=Kamppi&to=60.19860,24.93300&toName=Pasila&mode=bike");

    expect(await toField()).toHaveValue("Pasila");
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("Kamppi");
    expect(await within(await modes()).findByRole("radio", { name: /^Bike/ })).toBeChecked();
    expect(Object.fromEntries(tripQueries.at(-1)!)).toEqual({ from: "60.16,24.94", to: "60.1986,24.933" });
  });

  it("plans from another place when From is changed", async () => {
    places = [PASILA];
    renderApp("/?at=60.17000,24.95000&trip=true&to=60.20000,24.90000&toName=Somewhere");

    await userEvent.type(await screen.findByRole("combobox", { name: "From" }), "pasila");
    await userEvent.click(await screen.findByRole("option", { name: "Pasila, Helsinki" }));

    await waitFor(() => expect(tripQueries.at(-1)?.get("from")).toBe("60.1986,24.933"));
  });

  it("closes with Back", async () => {
    const history = renderApp("/?at=60.17000,24.95000");
    await userEvent.click(await screen.findByRole("button", { name: "Where to?" }));
    await toField();

    act(() => history.back());

    expect(await screen.findByRole("button", { name: "Where to?" })).toBeInTheDocument();
  });
});

describe("a Trip on the map", () => {
  const leg = (mode: "walk" | "tram" | "bike", line?: string) => ({
    mode,
    ...(line ? { line: { id: `HSL:${line}`, name: line } } : {}),
    from: { name: "A", lat: 60.17, lon: 24.95 },
    to: { name: "B", lat: 60.19, lon: 24.94 },
    start: "2026-10-31T12:00:00+02:00",
    end: "2026-10-31T12:10:00+02:00",
    stops: [],
    geometry: { type: "LineString" as const, coordinates: [[24.95, 60.17], [24.94, 60.19]] as [number, number][] },
  });
  const ride = (eventIds: string[], ...legs: ReturnType<typeof leg>[]) => ({
    start: "2026-10-31T12:00:00+02:00",
    end: "2026-10-31T12:20:00+02:00",
    durationS: 1200,
    legs,
    eventIds,
    onTheWay: eventIds.map((eventId) => ({ eventId, impact: "consider" as const, leg: 0, at: [24.945, 60.18] as [number, number], minutes: 3 })),
    comingUp: [],
    impact: eventIds.length ? ("consider" as const) : ("none" as const),
  });
  const onTheWay = anEvent("on the way", { where: { geometry: { type: "Point", coordinates: [24.945, 60.18] }, precision: "area" } });
  const TO = "/?at=60.17000,24.95000&trip=true&to=60.19000,24.94000&toName=Pasila";

  it("draws the chosen mode's best route, and pins and counts only what's on it", async () => {
    events = [anEvent("around here")];
    trip = {
      events: [onTheWay],
      plans: [
        { mode: "transit", itineraries: [ride(["on the way"], leg("walk"), leg("tram"), leg("walk"))] },
        { mode: "bike", itineraries: [ride([], leg("bike"))] },
      ],
    };
    renderApp(TO);

    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-route", "walk,tram,walk"));
    expect(await screen.findByRole("button", { name: "Works on the way, Drivers, some disruption" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Works around here,/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 thing on your way");
    expect(within(await screen.findByRole("region", { name: "On the way" })).getAllByRole("button")).toHaveLength(1);
  });

  it("lists and pins only what's in the way, where the trip meets it: what's merely nearby isn't shown", async () => {
    const minor = anEvent("beside the way");
    trip = {
      events: [onTheWay, minor],
      plans: [
        {
          mode: "transit",
          itineraries: [
            {
              ...ride(["on the way", "beside the way"], leg("walk"), leg("tram", "9"), leg("walk")),
              onTheWay: [
                { eventId: "beside the way", impact: "minor" as const, leg: 0, at: [24.95, 60.17] as [number, number], minutes: 1 },
                { eventId: "on the way", impact: "consider" as const, leg: 1, at: [24.945, 60.18] as [number, number], minutes: 6 },
              ],
            },
          ],
        },
      ],
    };
    renderApp(TO);

    const list = within(await screen.findByRole("region", { name: "On the way" }));
    expect(within(list.getByRole("list", { name: "Tram 9" })).getByRole("button", { name: /^Works on the way/ })).toHaveTextContent("at 6 min");
    expect(screen.getByRole("status")).toHaveTextContent("1 thing on your way");
    expect(screen.queryByRole("button", { name: /^Works beside the way/ })).not.toBeInTheDocument();
  });

  it("names a big event's crowd on the way and when it ends, in the list and on the itinerary", async () => {
    const concert = anEvent("concert", {
      kind: "public_event",
      title: { en: "Concert at the arena" },
      when: { start: "2026-10-31T09:00:00+02:00", end: "2026-10-31T12:00:00+02:00" },
      severity: "consider",
      mainlyAffected: "everyone",
      noticeable: ["crowd"],
    });
    trip = {
      events: [concert],
      plans: [
        {
          mode: "transit",
          itineraries: [
            {
              ...ride(["concert"], leg("walk"), leg("tram", "9"), leg("walk")),
              onTheWay: [
                {
                  eventId: "concert",
                  impact: "consider" as const,
                  leg: 1,
                  at: [24.945, 60.18] as [number, number],
                  minutes: 6,
                  crowd: { at: "end" as const, time: "2026-10-31T12:00:00+02:00" },
                },
              ],
            },
          ],
        },
      ],
    };
    renderApp(TO);

    const list = within(await screen.findByRole("region", { name: "On the way" }));
    expect(within(list.getByRole("list", { name: "Tram 9" })).getByRole("button", { name: /^Concert at the arena/ })).toHaveTextContent("Everyone · Ends about 12:00");
    expect((await within(await screen.findByRole("group", { name: "Routes" })).findAllByRole("radio"))[0]).toHaveAccessibleName(
      /1 in the way: Concert at the arena, ends about 12:00$/,
    );
  });

  it("lists what's on the whole way once, above the parts of the trip; a warning the trip runs into stays with its part", async () => {
    const slippery = anEvent("slippery", { kind: "weather", title: { en: "Orange slippery pavements" }, severity: "major", mainlyAffected: "pedestrians" });
    const storm = anEvent("storm", { kind: "weather", title: { en: "Yellow wind warning" }, severity: "consider", mainlyAffected: "everyone" });
    trip = {
      events: [onTheWay, slippery, storm],
      plans: [
        {
          mode: "transit",
          itineraries: [
            {
              ...ride(["on the way", "slippery", "storm"], leg("walk"), leg("tram", "9"), leg("walk")),
              onTheWay: [
                { eventId: "slippery", impact: "major" as const, leg: 0, at: [24.95, 60.17] as [number, number], minutes: 0, wholeWay: true },
                { eventId: "on the way", impact: "consider" as const, leg: 1, at: [24.945, 60.18] as [number, number], minutes: 6 },
                { eventId: "storm", impact: "consider" as const, leg: 2, at: [24.94, 60.19] as [number, number], minutes: 12, wholeWay: false },
              ],
            },
          ],
        },
      ],
    };
    renderApp(TO);

    const list = within(await screen.findByRole("region", { name: "On the way" }));
    expect(list.getAllByRole("heading").map((h) => h.textContent)).toEqual(["The whole way", "Tram 9", "Walking"]);
    expect(within(list.getByRole("list", { name: "The whole way" })).getByRole("button", { name: /^Orange slippery pavements/ })).toBeInTheDocument();
    expect(list.getAllByRole("button", { name: /^Orange slippery pavements/ })).toHaveLength(1);
    expect(within(list.getByRole("list", { name: "Walking" })).getByRole("button", { name: /^Yellow wind warning/ })).toBeInTheDocument();
  });

  it("redraws for another mode, and says when nothing is in the way", async () => {
    trip = {
      events: [onTheWay],
      plans: [
        { mode: "transit", itineraries: [ride(["on the way"], leg("tram"))] },
        { mode: "bike", itineraries: [ride([], leg("bike"))] },
      ],
    };
    renderApp(TO);

    await userEvent.click(await within(await screen.findByRole("group", { name: "Travel mode" })).findByRole("radio", { name: /^Bike/ }));

    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-route", "bike"));
    expect(screen.queryByRole("button", { name: /^Works on the way,/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Nothing in your way");
  });

  it("opens the card of an Event on the route", async () => {
    trip = { events: [onTheWay], plans: [{ mode: "transit", itineraries: [ride(["on the way"], leg("tram"))] }] };
    renderApp(TO);

    await userEvent.click(await screen.findByRole("button", { name: "Works on the way, Drivers, some disruption" }));

    expect(await screen.findByRole("article", { name: "Works on the way" })).toBeInTheDocument();
  });

  it("says it's finding routes while they load", async () => {
    server.use(http.get("*/v0/trips", async () => {
      await delay("infinite");
      return HttpResponse.json(trip);
    }));
    renderApp(TO);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Finding routes…"));
  });

    it("draws nothing until there is a route", async () => {
    trip = { events: [], plans: [{ mode: "transit", itineraries: [] }] };
    renderApp(TO);
    await screen.findByRole("group", { name: "Travel mode" });

    expect(screen.getByTestId("map")).toHaveAttribute("data-route", "");
  });
});

describe("a Trip's itineraries", () => {
  const leg = (mode: "walk" | "tram" | "bus", line?: string) => ({
    mode,
    ...(line ? { line: { id: `HSL:${line}`, name: line } } : {}),
    from: { name: "A", lat: 60.17, lon: 24.95 },
    to: { name: "B", lat: 60.19, lon: 24.94 },
    start: "2026-10-31T12:00:00+02:00",
    end: "2026-10-31T12:04:00+02:00",
    stops: [],
    geometry: { type: "LineString" as const, coordinates: [[24.95, 60.17], [24.94, 60.19]] as [number, number][] },
  });
  const ride = (end: string, eventIds: string[], impact: "none" | "consider" | "major", ...legs: ReturnType<typeof leg>[]) => ({
    start: "2026-10-31T12:00:00+02:00",
    end,
    durationS: (Date.parse(end) - Date.parse("2026-10-31T12:00:00+02:00")) / 1000,
    legs,
    eventIds,
    onTheWay: eventIds.map((eventId) => ({ eventId, impact: "consider" as const, leg: 1, at: [24.945, 60.18] as [number, number], minutes: 6 })),
    comingUp: [],
    impact,
  });
  const dig = anEvent("dig", { where: { geometry: { type: "Point", coordinates: [24.945, 60.18] }, precision: "area" } });
  const TO = "/?at=60.17000,24.95000&trip=true&to=60.19000,24.94000&toName=Pasila";
  const TRAM = ride("2026-10-31T12:15:00+02:00", ["dig"], "consider", leg("walk"), leg("tram", "2"), leg("walk"));
  const BUS = ride("2026-10-31T12:20:00+02:00", [], "none", leg("walk"), leg("bus", "69"), leg("walk"));
  const routes = async () => within(await screen.findByRole("group", { name: "Routes" }));

  it("lists the mode's itineraries with their legs, times and Impact, and draws the one picked", async () => {
    trip = { events: [dig], plans: [{ mode: "transit", itineraries: [TRAM, BUS] }] };
    const history = renderApp(TO);

    const rows = await (await routes()).findAllByRole("radio");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Walk 4 min, tram 2, walk 4 min. 12:00–12:15, 15 min, some disruption, 1 in the way: Works dig",
      "Walk 4 min, bus 69, walk 4 min. 12:00–12:20, 20 min",
    ]);
    expect(rows[0]).toBeChecked();

    await userEvent.click(rows[1]!);

    expect(history.location.search).toContain("route=1");
    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-route", "walk,bus,walk"));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing in your way");
  });

  it("starts on the way that's better today, and says what it avoids", async () => {
    trip = { events: [dig], plans: [{ mode: "transit", itineraries: [TRAM, BUS] }], recommended: { mode: "transit", index: 1 } };
    renderApp(TO);

    const better = await (await routes()).findByRole("radio", { name: /bus 69/ });
    expect(better).toBeChecked();
    expect(better).toHaveAccessibleName(/better today, avoids Works dig$/);
    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-route", "walk,bus,walk"));
    expect(within(await screen.findByRole("group", { name: "Travel mode" })).getByRole("radio", { name: /^Public transport, 20 min, better today/ })).toBeChecked();
  });

  it("lists what's on the chosen way under the routes", async () => {
    trip = { events: [dig], plans: [{ mode: "transit", itineraries: [TRAM, BUS] }] };
    renderApp(TO);

    const onTheWay = within(await screen.findByRole("list", { name: "Tram 2" }));
    expect(await onTheWay.findByRole("button", { name: /^Works dig/ })).toBeInTheDocument();
  });

  it("points out on the map what a row on the way is pointed at", async () => {
    trip = { events: [dig], plans: [{ mode: "transit", itineraries: [TRAM, BUS] }] };
    renderApp(TO);
    const row = await within(await screen.findByRole("list", { name: "Tram 2" })).findByRole("button", { name: /^Works dig/ });
    const map = screen.getByTestId("map");

    await userEvent.hover(row);
    expect(map).toHaveAttribute("data-emphasised", "dig");
    expect(map).toHaveAttribute("data-reveal", "dig");
    await userEvent.unhover(row);
    expect(map).toHaveAttribute("data-emphasised", "");
  });

  it("gives a heads-up of what starts on the chosen way in the coming week", async () => {
    const closure = anEvent("closure next week", { status: "upcoming" });
    const withHeadsUp = { ...BUS, comingUp: [{ eventId: "closure next week", impact: "consider" as const, leg: 1, at: [24.945, 60.18] as [number, number], minutes: 6, startsAt: "2026-11-05T06:00:00+02:00" }] };
    trip = { events: [dig, closure], plans: [{ mode: "transit", itineraries: [withHeadsUp] }] };
    renderApp(TO);

    const headsUp = await screen.findByRole("region", { name: "Heads up" });
    expect(headsUp).toHaveTextContent("From 5.11.2026 · Works closure next week (on the bus 69)");
    expect(screen.queryByRole("button", { name: /^Works closure next week/ })).not.toBeInTheDocument();
  });

  it("starts each mode from its first way again", async () => {
    trip = { events: [dig], plans: [{ mode: "transit", itineraries: [TRAM, BUS] }, { mode: "walk", itineraries: [ride("2026-10-31T12:40:00+02:00", [], "none", leg("walk"))] }] };
    const history = renderApp(`${TO}&route=1`);

    await userEvent.click(await within(await screen.findByRole("group", { name: "Travel mode" })).findByRole("radio", { name: /^Walk/ }));

    expect(history.location.search).not.toContain("route=");
    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-route", "walk"));
  });
});

describe("parking with a car Trip", () => {
  const leg = (mode: "walk" | "car" | "subway", minutes: number, extra: object = {}) => ({
    mode,
    from: { name: "A", lat: 60.17, lon: 24.95 },
    to: { name: "B", lat: 60.19, lon: 24.94 },
    start: "2026-11-01T12:00:00+02:00",
    end: new Date(Date.parse("2026-11-01T12:00:00+02:00") + minutes * 60_000).toISOString(),
    stops: [],
    geometry: { type: "LineString" as const, coordinates: [[24.95, 60.17], [24.94, 60.19]] as [number, number][] },
    ...extra,
  });
  const way = (minutes: number, ...legs: ReturnType<typeof leg>[]) => ({
    start: "2026-11-01T12:00:00+02:00",
    end: new Date(Date.parse("2026-11-01T12:00:00+02:00") + minutes * 60_000).toISOString(),
    durationS: minutes * 60,
    legs,
    eventIds: [],
    onTheWay: [],
    comingUp: [],
    impact: "none" as const,
  });
  const DRIVE = way(14, leg("car", 14));
  const PARK_AND_RIDE = way(34, leg("car", 12, { to: { name: "Niittykumpu", lat: 60.17, lon: 24.76, parking: "Niittykumpu" } }), leg("walk", 3), leg("subway", 15, { line: { id: "HSL:31M1", name: "M1" } }), leg("walk", 4));
  const PARKING: NonNullable<Trip["parking"]> = {
    street: { spaces: 19, paid: 15, free: 4, ev: 2, accessible: 1, radiusM: 300, places: [] },
    carParks: [{ name: "Postintaival", lat: 60.2, lon: 24.94, carSpaces: 47, distanceM: 600 }],
    sources: ["City of Helsinki (CC BY 4.0)", "HSL / Digitransit"],
    picks: [
      { reasons: ["closest"], kind: "street", lat: 60.199, lon: 24.933, distanceM: 80, spaces: 4, cost: "paid", perHour: 4, paidUntil: "21:00", maxStayMin: 240, disc: false },
      { reasons: ["cheapest"], kind: "street", lat: 60.2, lon: 24.933, distanceM: 250, spaces: 6, cost: "free", maxStayMin: 30, disc: true },
      { reasons: ["biggest"], kind: "carPark", name: "Postintaival", lat: 60.2, lon: 24.94, distanceM: 600, spaces: 47, cost: "unknown", disc: false },
    ],
  };
  const TO = "/?at=60.17000,24.95000&trip=true&to=60.19860,24.93300&toName=Pasila";

  it("lists park-and-ride ways under car, saying where to park, and every way's length", async () => {
    const long = way(14, leg("car", 14, { distanceM: 4150 }));
    trip = { events: [], plans: [{ mode: "car", itineraries: [long, PARK_AND_RIDE] }] };
    renderApp(`${TO}&mode=car`);

    const rows = await within(await screen.findByRole("group", { name: "Routes" })).findAllByRole("radio");
    expect(rows.map((r) => r.getAttribute("aria-label")?.split(". ")[0])).toEqual([
      "Drive 14 min",
      "Drive 12 min to P Niittykumpu, walk 3 min, metro M1, walk 4 min",
    ]);
    expect(rows[0]).toHaveAccessibleName(/, 14 min, 4\.2 km/);
    expect(rows[0]!.closest("label")).toHaveTextContent("4.2 km");
  });

  it("says where to park on arrival, numbered as on the map, then what parking there is around", async () => {
    const places = [
      { lat: 60.199, lon: 24.933, spaces: 4, kind: "paid" as const, cost: "paid" as const, perHour: 4, paidUntil: "21:00", maxStayMin: 240, disc: false },
      { lat: 60.1985, lon: 24.934, spaces: 2, kind: "other" as const, type: "ev" as const, disc: false },
    ];
    trip = { events: [], plans: [{ mode: "car", itineraries: [DRIVE] }], parking: { ...PARKING, street: { ...PARKING.street!, places } } };
    renderApp(`${TO}&mode=car`);

    const parking = await screen.findByRole("region", { name: "Parking near Pasila" });
    expect(within(parking).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "1Closest · Street parking80 m · 4 spaces · €4/h until 21:00 · max 4 h",
      "2Cheapest · Street parking250 m · 6 spaces · free · max 30 min · parking disc",
      "3Most spaces · Postintaival600 m · 47 spaces",
    ]);
    expect(parking).toHaveTextContent("19 spaces within 300 m · 15 paid · 4 free short-term · 2 for electric cars · 1 accessible");
    expect(parking).toHaveTextContent("City of Helsinki (CC BY 4.0), HSL / Digitransit");
    expect(screen.getByTestId("map")).toHaveAttribute("data-parking", "3 picks, 2 places");
  });

  it("marks the destination, tells what each spot on the map offers, and zooms to a pick chosen in the panel", async () => {
    const places = [
      { lat: 60.199, lon: 24.933, spaces: 4, kind: "paid" as const, cost: "paid" as const, perHour: 4, paidUntil: "21:00", maxStayMin: 240, disc: false },
      { lat: 60.1985, lon: 24.934, spaces: 2, kind: "other" as const, type: "ev" as const, disc: false },
    ];
    trip = { events: [], plans: [{ mode: "car", itineraries: [DRIVE] }], parking: { ...PARKING, street: { ...PARKING.street!, places } } };
    renderApp(`${TO}&mode=car`);

    const parking = await screen.findByRole("region", { name: "Parking near Pasila" });
    const map = screen.getByTestId("map");
    expect(map).toHaveAttribute("data-destination", "Pasila 60.1986,24.933");
    expect(within(screen.getByRole("list", { name: "parking spots on the map" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "4 spaces · €4/h until 21:00 · max 4 h",
      "2 spaces · for electric cars",
    ]);

    await userEvent.click(within(parking).getByRole("button", { name: /^Cheapest/ }));

    expect(map).toHaveAttribute("data-focus", "60.2,24.933");
  });

  it("says how many spaces are free at a park-and-ride, and why a way that parks at an almost full one is worth considering", async () => {
    const at = (name: string, free: number, almostFull: boolean, spaces: number) =>
      leg("car", 12, { to: { name, lat: 60.17, lon: 24.76, parking: name, parkingSpaces: spaces, parkingFree: { spaces: free, readAt: "2026-11-01T09:58:00Z", almostFull } } });
    const room = way(34, at("Tapiola Park", 541, false, 2049), leg("walk", 3), leg("subway", 15, { line: { id: "HSL:31M1", name: "M1" } }));
    const full = { ...way(36, at("Matinkylän asema", 6, true, 350), leg("walk", 3), leg("subway", 15, { line: { id: "HSL:31M1", name: "M1" } })), impact: "consider" as const };
    trip = { events: [], plans: [{ mode: "car", itineraries: [DRIVE, room, full] }] };
    renderApp(`${TO}&mode=car`);

    const rows = await within(await screen.findByRole("group", { name: "Routes" })).findAllByRole("radio");
    expect(rows[1]).toHaveAccessibleName(/^Drive 12 min to P Tapiola Park, 541 free of 2,049, walk 3 min/);
    expect(rows[1]!.closest("label")).toHaveTextContent("541 free");
    expect(rows[2]).toHaveAccessibleName(/some disruption, P Matinkylän asema almost full: 6 free$/);
    expect(rows[2]!.closest("label")).toHaveTextContent("P Matinkylän asema almost full: 6 free");
  });

  it("says how many spaces the car park picked on arrival has free, where it reports them", async () => {
    const free = { spaces: 6, readAt: "2026-11-01T09:58:00Z", almostFull: true };
    const picks = PARKING.picks.map((pick) => (pick.kind === "carPark" ? { ...pick, free } : pick));
    trip = { events: [], plans: [{ mode: "car", itineraries: [DRIVE] }], parking: { ...PARKING, picks } };
    renderApp(`${TO}&mode=car`);

    const parking = await screen.findByRole("region", { name: "Parking near Pasila" });
    expect(within(parking).getAllByRole("listitem")[2]).toHaveTextContent("3Most spaces · Postintaival600 m · almost full: 6 free of 47");
  });

  it("doesn't show parking at the destination for a park-and-ride way: you park on the way", async () => {
    trip = { events: [], plans: [{ mode: "car", itineraries: [DRIVE, PARK_AND_RIDE] }], parking: PARKING };
    renderApp(`${TO}&mode=car&route=1`);
    await screen.findByRole("group", { name: "Routes" });

    expect(screen.queryByRole("region", { name: "Parking near Pasila" })).not.toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-parking", "");
  });

  it("only shows parking with the car", async () => {
    trip = { events: [], plans: [{ mode: "transit", itineraries: [DRIVE] }, { mode: "car", itineraries: [DRIVE] }], parking: PARKING };
    renderApp(TO);
    await screen.findByRole("group", { name: "Routes" });

    expect(screen.queryByRole("region", { name: "Parking near Pasila" })).not.toBeInTheDocument();
  });
});
