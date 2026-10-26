import { describe, expect, it, vi } from "vitest";
import { conditionRetentionDays, createPool } from "./config.ts";

describe("conditionRetentionDays", () => {
  it("defaults to 90 days and reads a whole number of days", () => {
    expect(conditionRetentionDays({})).toBe(90);
    expect(conditionRetentionDays({ CONDITION_RETENTION_DAYS: "30" })).toBe(30);
  });

  it.each(["abc", "", "0", "-5", "1.5", "30 days"])("rejects %j with a config error", (value) => {
    expect(() => conditionRetentionDays({ CONDITION_RETENTION_DAYS: value })).toThrow(/CONDITION_RETENTION_DAYS/);
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
