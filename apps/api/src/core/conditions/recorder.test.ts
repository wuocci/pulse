import { describe, expect, it } from "vitest";
import vehiclePositions from "../adapters/fixtures/hfp/vehicle-positions.json" with { type: "json" };
import { parseHfp } from "../adapters/hfp.ts";
import { type DelaySample, DelayAggregator, type DelayListener, type DelayStream, type LineDelay, startDelayRecorder } from "./recorder.ts";

const at = (time: string) => new Date(`2026-10-26T${time}Z`);
const sample = (time: string, vehicle: string, delayS: number, line = "1004", direction = 1): DelaySample => ({
  line,
  direction,
  vehicle,
  delayS,
  at: at(time),
});

describe("DelayAggregator", () => {
  it("averages each vehicle first, then takes avg and p90 over vehicles per line and direction", () => {
    const aggregator = new DelayAggregator();
    aggregator.restart(at("09:00:00"));
    for (const delayS of [10, 20, 30]) aggregator.add(sample("09:01:00", "v1", delayS)); // v1 averages 20
    for (let v = 2; v <= 10; v++) aggregator.add(sample("09:02:00", `v${v}`, v * 10)); // 20..100
    aggregator.add(sample("09:03:00", "v1", 0, "1004", 2));

    const rows = aggregator.flush(at("09:06:00"));

    expect(rows).toEqual<LineDelay[]>([
      { bucket: at("09:00:00"), line: "1004", direction: 1, avgDelayS: 56, p90DelayS: 90, vehicleCount: 10 },
      { bucket: at("09:00:00"), line: "1004", direction: 2, avgDelayS: 0, p90DelayS: 0, vehicleCount: 1 },
    ]);
  });

  it("holds a bucket open until its grace period has passed, then emits it once", () => {
    const aggregator = new DelayAggregator({ graceMs: 30_000 });
    aggregator.restart(at("09:00:00"));
    aggregator.add(sample("09:04:59", "v1", 60));

    expect(aggregator.flush(at("09:05:10"))).toEqual([]);
    aggregator.add(sample("09:04:59", "v2", 120)); // late but within grace
    expect(aggregator.flush(at("09:05:30"))).toMatchObject([{ vehicleCount: 2, avgDelayS: 90 }]);

    expect(aggregator.add(sample("09:04:59", "v3", 0))).toBe(false); // bucket already written
    expect(aggregator.flush(at("09:20:00"))).toEqual([]);
  });

  it("never emits a partial bucket: samples before the first full bucket after a restart are dropped", () => {
    const aggregator = new DelayAggregator();
    aggregator.restart(at("09:02:00"));

    expect(aggregator.add(sample("09:03:00", "v1", 60))).toBe(false);
    expect(aggregator.add(sample("09:05:00", "v1", 60))).toBe(true);
    expect(aggregator.flush(at("09:11:00")).map((r) => r.bucket)).toEqual([at("09:05:00")]);
  });

  it("emits no row, not a zero, for a bucket without vehicles", () => {
    const aggregator = new DelayAggregator();
    aggregator.restart(at("09:00:00"));
    aggregator.add(sample("09:01:00", "v1", 60));
    aggregator.add(sample("09:11:00", "v1", 60));

    expect(aggregator.flush(at("09:20:00")).map((r) => r.bucket)).toEqual([at("09:00:00"), at("09:10:00")]);
  });

  it("stays bounded: drops new vehicles once the cap is reached", () => {
    const aggregator = new DelayAggregator({ maxVehicles: 2 });
    aggregator.restart(at("09:00:00"));

    expect(aggregator.add(sample("09:01:00", "v1", 0))).toBe(true);
    expect(aggregator.add(sample("09:01:00", "v2", 0))).toBe(true);
    expect(aggregator.add(sample("09:01:00", "v3", 0))).toBe(false);
    expect(aggregator.add(sample("09:01:30", "v1", 10))).toBe(true); // known vehicle still counts
    expect(aggregator.size).toBe(2);

    aggregator.flush(at("09:06:00"));
    expect(aggregator.size).toBe(0);
  });
});

// Recorded from mqtt.hsl.fi on 2026-10-26 09:20–09:27 UTC: tram line 4 (route 1004) and bus 510 (route 2510),
// thinned to one message per vehicle every 30 s. Duplicates and `dl: null` (journey not started) are as published.
describe("HFP vehicle positions → 5-minute Conditions", () => {
  it("parses a vp message into a delay sample, with delay positive when late", () => {
    const message = (dl: unknown) =>
      JSON.stringify({ VP: { route: "1004", dir: "2", oper: 40, veh: 465, tst: "2026-10-26T09:20:17.251Z", dl } });

    expect(parseHfp(Buffer.from(message(-95)))).toEqual<DelaySample>({
      line: "1004",
      direction: 2,
      vehicle: "40/465",
      delayS: 95,
      at: at("09:20:17.251"),
    });
    expect(parseHfp(message(30))?.delayS).toBe(-30);
  });

  it("skips messages without a usable delay", () => {
    expect(parseHfp(JSON.stringify({ VP: { route: "1004", dir: "1", oper: 40, veh: 1, tst: "2026-10-26T09:20:00Z", dl: null } }))).toBeNull();
    expect(parseHfp(JSON.stringify({ DOO: {} }))).toBeNull();
    expect(parseHfp("not json")).toBeNull();
  });

  it("turns a batch of recorded positions into the expected rows", () => {
    const aggregator = new DelayAggregator();
    aggregator.restart(at("09:20:00"));
    const samples = vehiclePositions.map((payload) => parseHfp(payload));
    expect(samples.filter((s) => s === null)).toHaveLength(8);
    for (const s of samples) if (s) aggregator.add(s);

    const row = (bucket: string, line: string, direction: number, avgDelayS: number, p90DelayS: number, vehicleCount: number) => ({
      bucket: at(bucket),
      line,
      direction,
      avgDelayS,
      p90DelayS,
      vehicleCount,
    });
    expect(aggregator.flush(at("09:31:00"))).toEqual<LineDelay[]>([
      row("09:20:00", "1004", 1, -63.1, 136.9, 5),
      row("09:20:00", "1004", 2, 3.4, 72.5, 4),
      row("09:20:00", "2510", 1, 102.2, 283.5, 6),
      row("09:20:00", "2510", 2, 58.8, 243.6, 6),
      row("09:25:00", "1004", 1, -43.7, 114, 5),
      row("09:25:00", "1004", 2, -40.9, 57.4, 4),
      row("09:25:00", "2510", 1, 108, 299.3, 6),
      row("09:25:00", "2510", 2, 91.8, 204, 6),
    ]);
  });
});

class FakeStream implements DelayStream {
  listener?: DelayListener;
  stopped = false;
  start(listener: DelayListener) {
    this.listener = listener;
    return () => {
      this.stopped = true;
    };
  }
}

describe("startDelayRecorder", () => {
  function setup() {
    const stream = new FakeStream();
    const written: LineDelay[][] = [];
    let now = at("09:00:00");
    const recorder = startDelayRecorder({
      sourceId: "test-hfp",
      stream,
      store: {
        async insertLineDelays(sourceId, rows) {
          expect(sourceId).toBe("test-hfp");
          written.push(rows);
        },
      },
      now: () => now,
      flushEveryMs: 0, // tests call recorder.flush() themselves
    });
    const listener = stream.listener!;
    return { stream, written, recorder, listener, setNow: (time: string) => (now = at(time)) };
  }

  it("writes complete buckets and leaves an outage as missing rows", async () => {
    const { written, recorder, listener, setNow, stream } = setup();
    listener.connected();
    listener.sample(sample("09:01:00", "v1", 60));
    setNow("09:06:00");
    listener.sample(sample("09:06:00", "v1", 60));

    setNow("09:07:00");
    listener.disconnected(); // 09:05 bucket is incomplete: dropped
    await recorder.flush();
    setNow("09:13:00");
    listener.connected(); // 09:10 bucket is incomplete too: recording resumes at 09:15
    listener.sample(sample("09:13:00", "v1", 60));
    listener.sample(sample("09:16:00", "v1", 60));
    setNow("09:21:00");
    await recorder.flush();

    expect(written.flat().map((r) => r.bucket)).toEqual([at("09:00:00"), at("09:15:00")]);
    recorder.stop();
    expect(stream.stopped).toBe(true);
  });
});
