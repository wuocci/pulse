import { describe, expect, it } from "vitest";
import { cacheKey } from "./cache.ts";
import { QUESTION_VERSION } from "./questions.ts";

const state = { notice: "Excavation notice", address: "Vilppulantie 26", text: "Sadevesiviemärin korjaus" };

describe("cacheKey", () => {
  it("is the same for the same state, whatever the order of its fields", () => {
    const reordered = { text: state.text, address: state.address, notice: state.notice };

    expect(cacheKey(reordered, "jev-1")).toEqual(cacheKey(state, "jev-1"));
  });

  it("changes when anything the Classifier reads changes", () => {
    expect(cacheKey({ ...state, address: "Vilppulantie 28" }, "jev-1").stateHash).not.toBe(cacheKey(state, "jev-1").stateHash);
  });

  it("carries the model and the current question version, so neither reuses another's answers", () => {
    expect(cacheKey(state, "jev-1")).toMatchObject({ model: "jev-1", questionVersion: QUESTION_VERSION });
    expect(cacheKey(state, "jev-2")).not.toEqual(cacheKey(state, "jev-1"));
  });

  it("is a SHA-256 hex digest", () => {
    expect(cacheKey(state, "jev-1").stateHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
