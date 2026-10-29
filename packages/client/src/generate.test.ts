import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate, SPEC_FILE, TYPES_FILE } from "./generate.ts";

describe("the committed spec and types", () => {
  it("match what the API produces now", async () => {
    const { spec, types } = await generate();

    expect(readFileSync(SPEC_FILE, "utf8"), "The API changed: run `pnpm --filter @pulse/client generate`").toBe(spec);
    expect(readFileSync(TYPES_FILE, "utf8"), "The types are stale: run `pnpm --filter @pulse/client generate`").toBe(types);
  });
});
