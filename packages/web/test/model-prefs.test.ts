import { beforeEach, describe, expect, it } from "vitest";
import { getLastModel, setLastModel } from "../src/state/model-prefs.js";

// The test environment is node; a Map is all the preference code needs.
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

describe("last model preference", () => {
  beforeEach(() => localStorage.clear());

  it("is empty until a model was used", () => {
    expect(getLastModel()).toBeNull();
  });

  it("round-trips model and effort", () => {
    setLastModel({ model: "gpt-5", effort: "high" });
    expect(getLastModel()).toEqual({ model: "gpt-5", effort: "high" });
    setLastModel({ model: "gpt-5-mini", effort: null });
    expect(getLastModel()).toEqual({ model: "gpt-5-mini", effort: null });
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem("codex-pocket.lastModel", "not json");
    expect(getLastModel()).toBeNull();
    localStorage.setItem("codex-pocket.lastModel", JSON.stringify({ effort: "low" }));
    expect(getLastModel()).toBeNull();
  });
});
