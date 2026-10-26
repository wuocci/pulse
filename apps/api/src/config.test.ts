import { describe, expect, it, vi } from "vitest";
import { classifierConfig, createPool } from "./config.ts";

describe("classifierConfig", () => {
  it("is off without an API key, so Events publish unclassified", () => {
    expect(classifierConfig({})).toBeNull();
    expect(classifierConfig({ TYPESAFE_API_KEY: "  " })).toBeNull();
  });

  it("reads the key, the pinned model and the threshold", () => {
    expect(
      classifierConfig({ TYPESAFE_API_KEY: "k", TYPESAFE_DEFAULT_MODEL: "jev-1.13.0", CLASSIFIER_THRESHOLD: "0.8" }),
    ).toEqual({ apiKey: "k", model: "jev-1.13.0", threshold: 0.8 });
  });

  it("defaults to jev-latest and a 0.7 threshold", () => {
    expect(classifierConfig({ TYPESAFE_API_KEY: "k" })).toEqual({ apiKey: "k", model: "jev-latest", threshold: 0.7 });
  });

  it("fails fast on a threshold outside (0, 1]", () => {
    for (const value of ["0", "1.5", "seven"]) {
      expect(() => classifierConfig({ TYPESAFE_API_KEY: "k", CLASSIFIER_THRESHOLD: value })).toThrow(/CLASSIFIER_THRESHOLD/);
    }
  });
});

describe("createPool", () => {
  it("logs idle-client errors instead of crashing, so the pool can reconnect", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = createPool({ DATABASE_URL: "postgres://pulse:pulse@localhost:1/pulse" });

    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
    expect(error).toHaveBeenCalledOnce();

    await pool.end();
    error.mockRestore();
  });
});
