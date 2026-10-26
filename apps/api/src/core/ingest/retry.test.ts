import { describe, expect, it } from "vitest";
import { retryWithBackoff } from "./retry.ts";

describe("retryWithBackoff", () => {
  it("retries a failing step with doubling, capped waits until it succeeds", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const connect = async () => {
      attempts++;
      if (attempts < 5) throw new Error("ECONNREFUSED");
      return "ready";
    };

    const result = await retryWithBackoff(connect, {
      initialMs: 1_000,
      maxMs: 5_000,
      sleep: async (ms) => void waits.push(ms),
      onRetry: () => {},
    });

    expect(result).toBe("ready");
    expect(attempts).toBe(5);
    expect(waits).toEqual([1_000, 2_000, 4_000, 5_000]);
  });

  it("reports each failure with the wait before the next attempt", async () => {
    const reported: [string, number][] = [];
    let attempts = 0;

    await retryWithBackoff(
      async () => {
        if (attempts++ === 0) throw new Error("down");
      },
      { initialMs: 10, sleep: async () => {}, onRetry: (error, waitMs) => reported.push([(error as Error).message, waitMs]) },
    );

    expect(reported).toEqual([["down", 10]]);
  });
});
