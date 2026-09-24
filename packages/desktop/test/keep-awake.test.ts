import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KeepAwake, readPrefs, wantsAwake, writePrefs } from "../src/keep-awake.js";

function fakeBlocker() {
  const held = new Set<number>();
  let next = 1;
  return {
    held,
    start: () => {
      const id = next++;
      held.add(id);
      return id;
    },
    stop: (id: number) => void held.delete(id),
  };
}

describe("KeepAwake", () => {
  it("holds one blocker while wanted and releases it after", () => {
    const blocker = fakeBlocker();
    const awake = new KeepAwake(blocker);
    awake.set(true);
    awake.set(true);
    expect(blocker.held.size).toBe(1);
    expect(awake.active).toBe(true);
    awake.set(false);
    expect(blocker.held.size).toBe(0);
    expect(awake.active).toBe(false);
  });
});

describe("wantsAwake", () => {
  it("keeps the Mac up only while the preference is on and the host is not stopped", () => {
    expect(wantsAwake(true, { kind: "running", status: { publicUrl: null, codexConnected: true, deviceCount: 0 } })).toBe(true);
    expect(wantsAwake(true, { kind: "starting" })).toBe(true);
    expect(wantsAwake(true, { kind: "stopped" })).toBe(false);
    expect(wantsAwake(false, { kind: "starting" })).toBe(false);
  });
});

describe("desktop prefs", () => {
  it("defaults to off and round-trips", () => {
    const home = mkdtempSync(join(tmpdir(), "pocket-prefs-"));
    expect(readPrefs(home)).toEqual({ keepAwake: false });
    writePrefs(home, { keepAwake: true });
    expect(readPrefs(home)).toEqual({ keepAwake: true });
  });

  it("falls back to defaults on a broken file", () => {
    const home = mkdtempSync(join(tmpdir(), "pocket-prefs-"));
    writeFileSync(join(home, "desktop.json"), "{not json");
    expect(readPrefs(home)).toEqual({ keepAwake: false });
  });
});
