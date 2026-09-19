import { beforeEach, describe, expect, it } from "vitest";
import { getPins, isPinned, togglePin } from "../src/state/pins.js";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

describe("pins", () => {
  beforeEach(() => memory.clear());

  it("starts empty and toggles, newest pin first", () => {
    expect(getPins()).toEqual([]);
    expect(togglePin("a")).toEqual(["a"]);
    expect(togglePin("b")).toEqual(["b", "a"]);
    expect(isPinned("a")).toBe(true);
    expect(togglePin("a")).toEqual(["b"]);
    expect(isPinned("a")).toBe(false);
  });

  it("survives garbage in storage", () => {
    memory.set("codex-pocket.pins", "{not json");
    expect(getPins()).toEqual([]);
    memory.set("codex-pocket.pins", JSON.stringify([1, "x", null]));
    expect(getPins()).toEqual(["x"]);
  });
});
