// A press that rests in place, on a map that has no long-press event of its own. Pixel positions in, pixel
// position out; the map turns it into a location.

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface LongPressOptions {
  onLongPress: (at: ScreenPoint) => void;
  delayMs?: number;
  // How far the finger may drift before it counts as a pan.
  tolerancePx?: number;
}

export function longPress({ onLongPress, delayMs = 500, tolerancePx = 10 }: LongPressOptions) {
  let start: ScreenPoint | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };

  return {
    down(at: ScreenPoint) {
      cancel();
      start = at;
      timer = setTimeout(() => {
        onLongPress(at);
        start = null;
      }, delayMs);
    },
    move(at: ScreenPoint) {
      if (start && Math.hypot(at.x - start.x, at.y - start.y) > tolerancePx) cancel();
    },
    up: cancel,
    cancel,
  };
}
