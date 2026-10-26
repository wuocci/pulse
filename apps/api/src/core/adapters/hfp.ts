import mqtt from "mqtt";
import type { DelaySample, DelayStream } from "../conditions/recorder.ts";
import type { HfpSource } from "../regions/index.ts";

// Adapter (ADR 0002) for HFP, HSL's high-frequency positioning format: every vehicle publishes its position and
// its offset from the timetable about once a second over MQTT. Only the delay is kept, as samples for the
// recorder, which aggregates them in memory (ADR 0008).

interface VehiclePosition {
  route?: unknown;
  dir?: unknown;
  oper?: unknown;
  veh?: unknown;
  tst?: unknown;
  dl?: unknown;
}

// One vp message as a delay sample, or null when it carries no usable delay.
export function parseHfp(payload: Buffer | string): DelaySample | null {
  let vp: VehiclePosition | undefined;
  try {
    vp = (JSON.parse(payload.toString()) as { VP?: VehiclePosition }).VP;
  } catch {
    return null;
  }
  if (!vp) return null;
  const { route, dir, oper, veh, tst, dl } = vp;
  if (typeof route !== "string" || route === "") return null;
  if (dir !== "1" && dir !== "2") return null;
  if (typeof dl !== "number" || !Number.isFinite(dl)) return null;
  if (typeof tst !== "string") return null;
  const at = new Date(tst);
  if (Number.isNaN(at.getTime())) return null;

  return {
    line: route,
    direction: Number(dir),
    // Vehicle numbers are unique per operator only.
    vehicle: `${String(oper)}/${String(veh)}`,
    // `dl` is the offset from the timetable: negative means behind schedule. Delay is the opposite.
    delayS: dl === 0 ? 0 : -dl,
    at,
  };
}

// Subscribes to the Source's topic and reconnects on its own (every 5 s) after any disconnect.
export function hfpStream(source: HfpSource): DelayStream {
  return {
    start(listener) {
      const client = mqtt.connect(source.url, { reconnectPeriod: 5_000, connectTimeout: 30_000 });
      let connected = false;

      client.on("connect", () => {
        client.subscribe(source.topic, { qos: 0 }, (error) => {
          if (error) console.error(`${source.id}: subscribe failed:`, error);
        });
        if (!connected) {
          connected = true;
          console.log(`${source.id}: connected`);
          listener.connected();
        }
      });
      client.on("close", () => {
        if (!connected) return;
        connected = false;
        console.warn(`${source.id}: disconnected, reconnecting`);
        listener.disconnected();
      });
      client.on("error", (error) => console.error(`${source.id}:`, error.message));
      client.on("message", (_topic, payload) => {
        const sample = parseHfp(payload);
        if (sample) listener.sample(sample);
      });

      return () => void client.end(true);
    },
  };
}
