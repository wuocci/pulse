import { describe, expect, it, vi } from "vitest";
import { createPool } from "./config.ts";

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
