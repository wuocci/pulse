import type { Event, GeocodeResult, Region } from "@pulse/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { LatLon, Platform } from "./platform.tsx";

// Around's map draws with WebGL, which jsdom lacks; Home links to it but never draws it.
vi.mock("./map/PointMap.tsx", () => ({ PointMap: () => <div data-testid="map" /> }));

const region: Region = { id: "test-region", name: { en: "Test region" }, bbox: [24.4, 60.0, 25.3, 60.45], timeZone: "Europe/Helsinki", languages: ["fi", "sv", "en"] };

const HOME: LatLon = { lat: 60.1841, lon: 24.9497 };
const WORK: LatLon = { lat: 60.1986, lon: 24.933 };
const HERE: LatLon = { lat: 60.17, lon: 24.95 };

// What /v0/events answers near each point ("lat,lon"), set per test.
let eventsNear: Record<string, Event[]> = {};
let geocoded: GeocodeResult[] = [];
const server = setupServer(
  http.get("*/v0/regions", () => HttpResponse.json({ regions: [region] })),
  http.get("*/v0/events", ({ request }) => {
    const [lat, lon] = (new URL(request.url).searchParams.get("near") ?? "").split(",");
    return HttpResponse.json({ events: eventsNear[`${Number(lat)},${Number(lon)}`] ?? [] });
  }),
  http.get("*/v0/geocode", () => HttpResponse.json({ results: geocoded })),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  eventsNear = {};
  geocoded = [];
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

describe("Home", () => {
  it("leads with Where to?, which starts a Trip", async () => {
    renderHome(fakePlatform({ places: PLACES }).platform);

    expect(await screen.findByRole("link", { name: /Where to\?/ })).toHaveAttribute("href", "/around?trip=true");
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

    await waitFor(() => expect(screen.queryByText("Checking…")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Changes your plans now" })).not.toBeInTheDocument();
    expect(screen.queryByText(/clear/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Everything going on around you/ })).toHaveAttribute("href", "/around");
  });

  it("opens a place to its Events, an Event to its card, and the card to its Details", async () => {
    const user = userEvent.setup();
    near(HOME, [anEvent("a", { arrangementType: "detour", title: { en: "Traffic arrangement · Hämeentie 5" }, originalText: { fi: "Kiertotie Hämeentiellä." } })]);
    renderHome(fakePlatform({ places: PLACES }).platform);

    await user.click(await screen.findByRole("button", { name: /Home.*1 thing changes plans/ }));
    const row = await screen.findByRole("button", { name: /Detour.*Detour: expect slower driving/ });
    expect(row).toHaveAttribute("aria-expanded", "false");

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const card = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(within(card).getByText("Some disruption")).toBeInTheDocument();
    expect(within(card).getByText("Hämeentie 5")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Details" }));
    expect(within(card).getByText("Kiertotie Hämeentiellä.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /City of Helsinki/ })).toHaveAttribute("href", "https://example.test/a");
  });

  it("leads a row with the street when its title says nothing specific", async () => {
    const user = userEvent.setup();
    near(HOME, [anEvent("a", { arrangementType: "other", title: { en: "Traffic arrangement · Tulistimenkatu" } })]);
    renderHome(fakePlatform({ places: PLACES }).platform);

    await user.click(await screen.findByRole("button", { name: /Home/ }));
    expect(await screen.findByRole("button", { name: /^Tulistimenkatu\s*Street partly blocked/ })).toBeInTheDocument();
  });

  it("without saved places, asks for Home and Work and watches where you are, if location is already allowed", async () => {
    near(HERE, [anEvent("a")]);
    renderHome(fakePlatform({ location: HERE }).platform);

    expect(await screen.findByText(/Add Home and Work/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Here.*1 thing changes plans/ })).toBeInTheDocument();
  });

  it("saves a place on the phone: a name and an address", async () => {
    const user = userEvent.setup();
    geocoded = [{ name: "Kallio", label: "Kallio, Helsinki", lat: 60.1841, lon: 24.9497 } as GeocodeResult];
    const { platform, storage } = fakePlatform();
    renderHome(platform);

    await user.click(await screen.findByRole("button", { name: "+ Add" }));
    const form = screen.getByRole("form", { name: "Add a place" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Home");
    await user.type(within(form).getByRole("combobox"), "Kallio");
    await user.click(await within(form).findByRole("option", { name: /Kallio/ }));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Home", lat: 60.1841, lon: 24.9497 }]);
  });

  it("removes a place in Edit", async () => {
    const user = userEvent.setup();
    const { platform, storage } = fakePlatform({ places: PLACES });
    renderHome(platform);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Remove Work" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("link", { name: "Work" })).not.toBeInTheDocument();
    expect(JSON.parse(storage.get("places")!)).toEqual([{ name: "Home", ...HOME }]);
  });
});
