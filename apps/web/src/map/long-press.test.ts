import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { longPress } from "./long-press.ts";

describe("long press", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const onLongPress = vi.fn();
    return { press: longPress({ onLongPress }), onLongPress };
  };

  it("fires where the finger is after it rests for half a second", () => {
    const { press, onLongPress } = setup();

    press.down({ x: 100, y: 200 });
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onLongPress).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 200 });
  });

  it("allows a little jitter, but a pan is not a long press", () => {
    const { press, onLongPress } = setup();

    press.down({ x: 100, y: 200 });
    press.move({ x: 106, y: 204 });
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledOnce();

    press.down({ x: 100, y: 200 });
    press.move({ x: 115, y: 200 });
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it("is a tap, not a long press, when the finger lifts early", () => {
    const { press, onLongPress } = setup();

    press.down({ x: 100, y: 200 });
    vi.advanceTimersByTime(300);
    press.up();
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("is cancelled by a second finger, as when pinching to zoom", () => {
    const { press, onLongPress } = setup();

    press.down({ x: 100, y: 200 });
    press.cancel();
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
