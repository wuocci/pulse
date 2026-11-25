import { afterEach, describe, expect, it, vi } from "vitest";
import type { Region } from "../regions/index.ts";
import { type CarParkOccupancy, type CarParkReading, startOccupancyIngest, startOccupancyRecorder } from "./occupancy.ts";

const at = (time: string) => new Date(`2026-11-25T${time}Z`);
const readings: CarParkReading[] = [
  { facility: "liipi:308", freeSpaces: 13, capacity: 26 },
  { facility: "liipi:990", freeSpaces: 0, capacity: 120 },
];

function memoryStore() {
  const rows: CarParkOccupancy[] = [];
  return { rows, insertCarParkOccupancy: vi.fn(async (_sourceId: string, written: CarParkOccupancy[]) => void rows.push(...written)) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startOccupancyRecorder", () => {
  it("writes one row per car park, in the 5-minute bucket of the read", async () => {
    const store = memoryStore();
    const recorder = startOccupancyRecorder({ sourceId: "p", reader: { read: async () => readings }, store, now: () => at("09:07:31"), schedule: false });

    await recorder.read();

    expect(store.insertCarParkOccupancy).toHaveBeenCalledWith("p", readings.map((r) => ({ ...r, bucket: at("09:05:00") })));
  });

  it("reads a bucket once", async () => {
    const read = vi.fn(async () => readings);
    const store = memoryStore();
    let now = at("09:05:30");
    const recorder = startOccupancyRecorder({ sourceId: "p", reader: { read }, store, now: () => now, schedule: false });

    await recorder.read();
    now = at("09:09:00");
    await recorder.read();
    now = at("09:10:30");
    await recorder.read();

    expect(read).toHaveBeenCalledTimes(2);
    expect(store.rows.map((r) => r.bucket)).toEqual([at("09:05:00"), at("09:05:00"), at("09:10:00"), at("09:10:00")]);
  });

  it("leaves a gap when the read fails, or takes into the next bucket", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = memoryStore();
    let now = at("09:05:30");
    const failing = startOccupancyRecorder({ sourceId: "p", reader: { read: async () => Promise.reject(new Error("502")) }, store, now: () => now, schedule: false });
    await failing.read();

    const slow = startOccupancyRecorder({
      sourceId: "p",
      reader: {
        read: async () => {
          now = at("09:10:01");
          return readings;
        },
      },
      store,
      now: () => now,
      schedule: false,
    });
    await slow.read();

    expect(store.rows).toEqual([]);
  });

  it("reads 30 seconds into every bucket on its own", async () => {
    vi.useFakeTimers({ now: at("09:03:00") });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const read = vi.fn(async () => readings);
    const recorder = startOccupancyRecorder({ sourceId: "p", reader: { read }, store: memoryStore() });

    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1); // at start, for 09:00
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 29_000); // 09:05:29
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000); // 09:05:30
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000); // 09:10:30
    expect(read).toHaveBeenCalledTimes(3);

    recorder.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe("startOccupancyIngest", () => {
  it("records only the car park Sources it can read", () => {
    vi.useFakeTimers();
    const region = {
      conditionSources: [
        { id: "hfp", adapter: "hfp", url: "", topic: "", publisher: "", license: "" },
        { id: "parks", adapter: "digitransit-parking", url: "", publisher: "", license: "" },
      ],
    } as unknown as Region;
    const open = vi.fn(() => null);

    startOccupancyIngest([region], memoryStore(), open)();

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "parks" }), region);
  });
});
