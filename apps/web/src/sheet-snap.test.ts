import { describe, expect, it } from "vitest";
import { snapAfterDrag } from "./sheet-snap.ts";

// The sheet travels 600 px between its peek and expanded heights. dy < 0 is up.
const TRAVEL = 600;
const slow = 0.1;

describe("where the sheet settles after a drag", () => {
  it("stays put after a short, slow drag", () => {
    expect(snapAfterDrag({ from: "peek", dy: -200, velocity: -slow, travel: TRAVEL })).toBe("peek");
    expect(snapAfterDrag({ from: "expanded", dy: 200, velocity: slow, travel: TRAVEL })).toBe("expanded");
  });

  it("moves on once dragged past halfway", () => {
    expect(snapAfterDrag({ from: "peek", dy: -301, velocity: -slow, travel: TRAVEL })).toBe("expanded");
    expect(snapAfterDrag({ from: "expanded", dy: 301, velocity: slow, travel: TRAVEL })).toBe("peek");
  });

  it("follows a quick flick, however short", () => {
    expect(snapAfterDrag({ from: "peek", dy: -40, velocity: -0.8, travel: TRAVEL })).toBe("expanded");
    expect(snapAfterDrag({ from: "expanded", dy: 40, velocity: 0.8, travel: TRAVEL })).toBe("peek");
  });

  it("doesn't move past its ends", () => {
    expect(snapAfterDrag({ from: "peek", dy: 200, velocity: 0.8, travel: TRAVEL })).toBe("peek");
    expect(snapAfterDrag({ from: "expanded", dy: -200, velocity: -0.8, travel: TRAVEL })).toBe("expanded");
  });
});
