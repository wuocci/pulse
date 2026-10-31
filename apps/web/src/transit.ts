import type { Schema } from "@pulse/client";
import { Bike, Bus, Circle, Footprints, type LucideIcon, Ship, TrainFront, TrainFrontTunnel, TramFront } from "lucide-react";

// How each kind of leg looks, on the map and in the lists alike: HSL's colours for its modes, so a line reads the
// way it does on the stop signs.

type LegMode = Schema<"LegMode">;

export const LEG_STYLE: Record<LegMode, { icon: LucideIcon; colour: string }> = {
  walk: { icon: Footprints, colour: "#64748b" },
  bike: { icon: Bike, colour: "#15803d" },
  bus: { icon: Bus, colour: "#007ac9" },
  tram: { icon: TramFront, colour: "#00985f" },
  rail: { icon: TrainFront, colour: "#8c4799" },
  subway: { icon: TrainFrontTunnel, colour: "#ff6319" },
  ferry: { icon: Ship, colour: "#00b9e4" },
  other: { icon: Circle, colour: "#64748b" },
};
