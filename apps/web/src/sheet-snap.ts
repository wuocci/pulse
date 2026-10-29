// Where the bottom sheet settles when a drag ends: a quick flick goes the way it was flicked, otherwise the
// sheet moves on only once dragged past halfway.

export type Snap = "peek" | "expanded";

// px per ms; a finger moving faster than this when it lifts is a flick.
const FLICK = 0.5;

export interface Drag {
  from: Snap;
  // How far the finger moved; negative is up.
  dy: number;
  // At the moment it lifted, px per ms; negative is up.
  velocity: number;
  // The distance between the peek and expanded positions.
  travel: number;
}

export function snapAfterDrag({ from, dy, velocity, travel }: Drag): Snap {
  // Up opens, down closes; the other way just stays.
  const towards: Snap = from === "peek" ? "expanded" : "peek";
  const sign = from === "peek" ? -1 : 1;
  if (sign * velocity > FLICK) return towards;
  return sign * dy > travel / 2 ? towards : from;
}
