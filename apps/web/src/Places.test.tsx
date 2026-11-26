import type { Event, GeocodeResult, Region } from "@pulse/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { LatLon, Platform } from "./platform.tsx";

// The map draws with WebGL, which jsdom lacks; these tests are about your places, not the map.
vi.mock("./map/PointMap.tsx", () => ({ PointMap: () => <div data-testid="map" /> }));

const region: Region = { id: "test-region", name: { en: "Test region" }, bbox: [24.4, 60.0, 25.3, 60.45], timeZone: "Europe/Helsinki", languages: ["fi", "sv", "en"] };

const HOME: LatLon = { lat: 60.1841, lon: 24.9497 };
const WORK: LatLon = { lat: 60.1986, lon: 24.933 };
const HERE: LatLon = { lat: 60.17, lon: 24.95 };

// What /v0/events answers near each point ("lat,lon"), set per test.
let eventsNear: Record<string, Event[]> = {};
// Where events were asked for ("lat,lon"), so a test can wait for a place's answer.
let askedNear: string[] = [];
let geocoded: GeocodeResult[] = [];
// The address /v0/geocode/reverse names any point by, set per test; none by default.
let addressAt: GeocodeResult | undefined;
const server = setupServer(
  http.get("*/v0/regions", () => HttpResponse.json({ regions: [region] })),
  http.get("*/v0/events", ({ request }) => {
    const [lat, lon] = (new URL(request.url).searchParams.get("near") ?? "").split(",");
    askedNear.push(`${Number(lat)},${Number(lon)}`);
    return HttpResponse.json({ events: eventsNear[`${Number(lat)},${Number(lon)}`] ?? [] });
  }),
  http.get("*/v0/geocode/reverse", () => HttpResponse.json(addressAt ? { result: addressAt } : {})),
  http.get("*/v0/geocode", () => HttpResponse.json({ results: geocoded })),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  eventsNear = {};
  askedNear = [];
  geocoded = [];
  addressAt = undefined;
});
afterAll(() => server.close());

const near = ({ lat, lon }: LatLon, events: Event[]) => {
  eventsNear[`${lat},${lon}`] = events;
};

const anEvent = (id: string, patch: Partial<Event> = {}): Event => ({
  id,
  kind: "closure",
  layers: ["area", "trips", "now"],
  title: { en: `Closed · Street ${id}` },
  where: { geometry: { type: "Point", coordinates: [24.95, 60.18] }, precision: "exact" },
  when: { start: "2026-10-01T00:00:00+03:00", end: "2027-12-31T23:59:59+02:00" },
  severity: "consider",
  mainlyAffected: "drivers",
  decision: "change_plans",
  noticeable: ["blocked"],
  status: "active",
  sources: [{ name: "City of Helsinki", id, url: `https://example.test/${id}`, updatedAt: "2026-10-01T00:00:00+03:00", license: "CC BY 4.0" }],
  confidence: 0.9,
  updatedAt: "2026-10-01T00:00:00+03:00",
  ...patch,
});

function fakePlatform({ places, location }: { places?: { name: string; lat: number; lon: number }[]; location?: LatLon } = {}) {
  const storage = new Map<string, string>(places ? [["places", JSON.stringify(places)]] : []);
  const platform: Platform = {
    location: {
      current: async () => {
        if (!location) throw new Error("no location");
        return location;
      },
      watch: () => () => {},
      allowed: async () => !!location,
    },
    storage: { get: async (key) => storage.get(key) ?? null, set: async (key, value) => void storage.set(key, value) },
  };
  return { platform, storage };
}

function renderHome(platform: Platform) {
  const history = createMemoryHistory({ initialEntries: ["/"] });
  render(<App platform={platform} history={history} />);
  return history;
}

const PLACES = [
  { name: "Home", ...HOME },
  { name: "Work", ...WORK },
];

describe("Home: your places", () => {
  it("leads with Where to?, which starts a Trip", async () => {
    const history = renderHome(fakePlatform({ places: PLACES }).platform);

    await userEvent.click(await screen.findByRole("button", { name: /Where to\?/ }));

    expect(await screen.findByRole("combobox", { name: "To" })).toHaveFocus();
    expect(history.location.pathname).toBe("/");
    expect(history.location.search).toContain("trip=true");
  });

  it("is Around, where Around was: an old link lands on the same view", async () => {
    const history = createMemoryHistory({ initialEntries: ["/around?at=60.18410,24.94970&trip=true"] });
    render(<App platform={fakePlatform({ places: PLACES }).platform} history={history} />);

    expect(await screen.findByRole("combobox", { name: "To" })).toBeInTheDocument();
    expect(history.location.pathname).toBe("/");
    expect(history.location.search).toContain("trip=true");
  });

  it("makes each saved place a one-tap destination", async () => {
    renderHome(fakePlatform({ places: PLACES }).platform);

    const work = await screen.findByRole("link", { name: "Work" });
    expect(work.getAttribute("href")).toContain("to=60.19860%2C24.93300");
    expect(work.getAttribute("href")).toContain("toName=Work");
  });

  it("shows a line only for the places where something changes plans, with how many and how many are major", async () => {
    near(HOME, [anEvent("a"), anEvent("b", { severity: "major" })]);
    near(WORK, [anEvent("c", { decision: "worth_knowing" })]);
    renderHome(fakePlatform({ places: PLACES }).platform);

    const line = await screen.findByRole("button", { name: /Home.*2 things change plans · 1 major/ });
    expect(line).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "Changes your plans now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Work/ })).not.toBeInTheDocument();
  });

  it("says nothing at all when nothing changes plans: no counts, no all clear", async () => {
    near(HOME, [anEvent("a", { decision: "worth_knowing" }), anEvent("b", { decision: "no_effect" }), anEvent("c", { decision: undefined })]);
    near(WORK, []);
    renderHome(fakePlatform({ places: PLACES }).platform);

    await waitFor(() => expect(askedNear).toEqual(expect.arrayContaining([`${HOME.lat},${HOME.lon}`, `${WORK.lat},${WORK.lon}`])));
    await screen.findByRole("group", { name: "Your places" });
    expect(screen.queryByRole("heading", { name: "Changes your plans now" })).not.toBeInTheDocument();
    expect(screen.queryByText(/clear/i)).not.toBeInTheDocument();
  });

  it("opens a place to its Events, an Event to its card, and the card to its Details", async () => {
    const user = userEvent.setup();
    near(HOME, [anEvent("a", { arrangementType: "detour", title: { en: "Traffic arrangement · Hämeentie 5" }, originalText: { fi: "Kiertotie Hämeentiellä." } })]);
    renderHome(fakePlatform({ places: PLACES }).platform);

    await user.click(await screen.findByRole("button", { name: /Home.*1 thing changes plans/ }));
    const row = await screen.findByRole("button", { name: /^Hämeentie 5\s*Detour: expect slower driving/ });
    expect(row).toHaveAttribute("aria-expanded", "false");

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const card = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(within(card).getByText("Some disruption")).toBeInTheDocument();
    expect(within(card).getByText("Detour")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Details" }));
    expect(within(card).getByText("Kiertotie Hämeentiellä.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /City of Helsinki/ })).toHaveAttribute("href", "https://example.test/a");
  });

  it("leads a row with the street when its title says nothing specific", async () => {
    const user = userEvent.setup();
    near(HOME, [anEvent("a", { arrangementType: "other", title: { en: "Traffic arrangement · Tulistimenkatu" } })]);
    renderHome(fakePlatform({ places: PLACES }).platform);

    await user.click(await screen.findByRole("button", { name: /Home.*changes plans/ }));
    expect(await screen.findByRole("button", { name: /^Tulistimenkatu\s*Street partly blocked/ })).toBeInTheDocument();
  });

  it("without saved places, asks for Home and Work, and looks around where you are", async () => {
    near(HERE, [anEvent("a")]);
    const history = renderHome(fakePlatform({ location: HERE }).platform);

    expect(await screen.findByText(/Set Home and Work/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Work" })).toBeInTheDocument();
    // Where you are is the point the list looks around, not a place line of its own.
    await waitFor(() => expect(history.location.search).toContain("at=60.17000%2C24.95000"));
    expect(screen.queryByRole("heading", { name: "Changes your plans now" })).not.toBeInTheDocument();
  });

  it("sets Home on the phone: a name and an address", async () => {
    const user = userEvent.setup();
    geocoded = [{ name: "Kallio", label: "Kallio, Helsinki", lat: 60.1841, lon: 24.9497 } as GeocodeResult];
    const { platform, storage } = fakePlatform();
    renderHome(platform);

    await user.click(await screen.findByRole("button", { name: "Set Home" }));
    const form = screen.getByRole("form", { name: "Add a place" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Home");
    await user.type(within(form).getByRole("combobox"), "Kallio");
    await user.click(await within(form).findByRole("option", { name: /Kallio/ }));
    expect(within(form).getByRole("status")).toHaveTextContent("At: Kallio, Helsinki");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set Home" })).not.toBeInTheDocument();
    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Home", lat: 60.1841, lon: 24.9497 }]);
  });

  it("sets Work where you are, in two taps", async () => {
    const user = userEvent.setup();
    const { platform, storage } = fakePlatform({ location: HERE });
    renderHome(platform);

    await user.click(await screen.findByRole("button", { name: "Set Work" }));
    const form = screen.getByRole("form", { name: "Add a place" });
    await user.click(within(form).getByRole("button", { name: "Use my location" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("At: Current location");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Work", ...HERE }]);
  });

  it("saves the place it looks around, from its heading", async () => {
    const user = userEvent.setup();
    const { platform, storage } = fakePlatform();
    const history = createMemoryHistory({ initialEntries: ["/?at=60.17000,24.95000"] });
    render(<App platform={platform} history={history} />);

    await user.click(await screen.findByRole("button", { name: "Save" }));
    const form = screen.getByRole("form", { name: "Add a place" });
    await user.click(within(form).getByRole("button", { name: "Work" }));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Work", ...HERE }]);
    expect(await screen.findByRole("button", { name: /^Around Work/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("saves a Trip's To as a place", async () => {
    const user = userEvent.setup();
    const { platform, storage } = fakePlatform();
    const history = createMemoryHistory({ initialEntries: ["/?at=60.17000,24.95000&trip=true&to=60.19860,24.93300&toName=Pasila"] });
    render(<App platform={platform} history={history} />);

    await user.click(await screen.findByRole("button", { name: "Save Pasila as a place" }));
    const form = screen.getByRole("form", { name: "Add a place" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Pasila");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Pasila", ...WORK }]);
    expect(screen.queryByRole("button", { name: "Save Pasila as a place" })).not.toBeInTheDocument();
  });

  it("changes a place when it's held: renamed, or removed", async () => {
    const user = userEvent.setup();
    const { platform, storage } = fakePlatform({ places: [...PLACES, { name: "Gym", lat: 60.2, lon: 24.9 }] });
    renderHome(platform);

    await user.pointer({ keys: "[MouseRight]", target: await screen.findByRole("link", { name: "Gym" }) });
    let form = screen.getByRole("form", { name: "Change Gym" });
    await user.clear(within(form).getByLabelText("Name"));
    await user.type(within(form).getByLabelText("Name"), "Work");
    expect(within(form).getByText("Replaces your current Work.")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Home", ...HOME }, { name: "Work", lat: 60.2, lon: 24.9 }]);

    await user.pointer({ keys: "[MouseRight]", target: await screen.findByRole("link", { name: "Work" }) });
    form = screen.getByRole("form", { name: "Change Work" });
    await user.click(within(form).getByRole("button", { name: "Remove Work" }));

    expect(screen.queryByRole("link", { name: "Work" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Work" })).toBeInTheDocument();
    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Home", ...HOME }]);
  });

  it("changes places in Settings too", async () => {
    const user = userEvent.setup();
    const { platform, storage } = fakePlatform({ places: PLACES });
    renderHome(platform);

    await user.click((await screen.findAllByRole("button", { name: "Settings" }))[0]!);
    const list = within(screen.getByRole("region", { name: "Your places" }));
    await user.click(list.getByRole("button", { name: /^Home/ }));
    await user.click(list.getByRole("button", { name: "Remove Home" }));

    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Work", ...WORK }]);
  });

  it("looks around one of your places, from the heading", async () => {
    const user = userEvent.setup();
    const history = renderHome(fakePlatform({ places: PLACES }).platform);

    await user.click(await screen.findByRole("button", { name: /^Around / }));
    await user.click(within(screen.getByRole("group", { name: "Where to look around" })).getByRole("button", { name: "Work" }));

    await waitFor(() => expect(history.location.search).toContain("at=60.19860%2C24.93300"));
    expect(screen.getByRole("button", { name: /^Around Work/ })).toBeInTheDocument();
  });
});
