import { describe, expect, it } from "vitest";
import { buildMenu, COLORS, relativeTime, staleDevices, trayColor, trayTooltip, type MenuItem } from "../src/menu.js";

const NOW = Date.parse("2026-09-21T10:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const device = (id: string, name: string, lastSeenAt: number, push = false) => ({ id, name, createdAt: lastSeenAt - DAY, lastSeenAt, push });

const items = (entries: ReturnType<typeof buildMenu>) => entries.filter((e): e is MenuItem => e !== "separator");
const labels = (entries: ReturnType<typeof buildMenu>) => items(entries).map((i) => i.label);
const byAction = (entries: ReturnType<typeof buildMenu>, action: string) => items(entries).find((i) => i.action === action);

describe("buildMenu", () => {
  it("offers Start when stopped and keeps pairing disabled", () => {
    const m = buildMenu({ kind: "stopped" }, []);
    expect(labels(m)[0]).toBe("Host stopped");
    expect(byAction(m, "start")).toBeDefined();
    expect(byAction(m, "stop")).toBeUndefined();
    expect(byAction(m, "pair")?.enabled).toBe(false);
    expect(byAction(m, "restart")?.enabled).toBe(false);
  });

  it("shows the address, daemon state and devices when running", () => {
    const m = buildMenu({ kind: "running", status: { publicUrl: "http://10.0.0.2:7333", codexConnected: true, deviceCount: 1 } }, [device("d1", "Pixel", NOW - 5 * MIN)], NOW);
    expect(labels(m).slice(0, 2)).toEqual(["Host running at http://10.0.0.2:7333", "Codex daemon: connected"]);
    expect(byAction(m, "pair")?.enabled).toBe(true);
    expect(byAction(m, "stop")).toBeDefined();
    const devices = items(m).find((i) => i.label === "1 paired phone");
    expect(devices?.submenu?.[0].label).toBe("Pixel · 5 min ago");
    expect(devices?.submenu?.[0].submenu?.at(-1)?.action).toEqual({ revoke: "d1" });
  });

  it("lists phones most recently seen first, marking the ones with push", () => {
    const devices = [device("old", "iPhone", NOW - 10 * DAY), device("now", "iPhone", NOW - MIN, true), device("mid", "Mac browser", NOW - 2 * DAY)];
    const m = buildMenu({ kind: "running", status: { publicUrl: "http://x", codexConnected: true, deviceCount: 3 } }, devices, NOW);
    const sub = items(m).find((i) => i.label === "3 paired phones")?.submenu ?? [];
    expect(sub.map((i) => i.label)).toEqual(["iPhone · 1 min ago · push", "Mac browser · 2 d ago", "iPhone · 10 d ago", "Revoke phones not seen in 7 days"]);
    expect(sub.at(-1)?.action).toBe("revoke-stale");
    expect(sub.at(-1)?.enabled).toBe(true);
  });

  it("disables the stale cleanup when every phone is recent", () => {
    const m = buildMenu({ kind: "running", status: { publicUrl: "http://x", codexConnected: true, deviceCount: 1 } }, [device("a", "iPhone", NOW)], NOW);
    const sub = items(m).find((i) => i.label === "1 paired phone")?.submenu ?? [];
    expect(sub.at(-1)?.enabled).toBe(false);
  });

  it("reports a disconnected daemon", () => {
    const m = buildMenu({ kind: "running", status: { publicUrl: "http://x", codexConnected: false, deviceCount: 0 } }, []);
    expect(labels(m)[1]).toBe("Codex daemon: not connected");
  });

  it("surfaces the error and allows a restart", () => {
    const m = buildMenu({ kind: "error", message: "host exited with code 1" }, []);
    expect(labels(m)[0]).toBe("Host error: host exited with code 1");
    expect(byAction(m, "restart")?.enabled).toBe(true);
    expect(byAction(m, "start")).toBeDefined();
  });

  it("offers keeping the Mac awake as a checkbox reflecting the preference", () => {
    const toggle = (keepAwake: boolean) => items(buildMenu({ kind: "stopped" }, [], NOW, keepAwake)).find((i) => i.action === "keep-awake");
    expect(toggle(false)).toMatchObject({ label: "Keep this Mac awake", checked: false });
    expect(toggle(true)?.checked).toBe(true);
  });

  it("always ends with Quit", () => {
    expect(items(buildMenu({ kind: "starting" }, [])).at(-1)?.action).toBe("quit");
  });
});

describe("trayColor", () => {
  it("is green only when phones can actually reach Codex", () => {
    expect(trayColor({ kind: "running", status: { publicUrl: "http://x", codexConnected: true, deviceCount: 0 } })).toBe(COLORS.running);
    expect(trayColor({ kind: "running", status: { publicUrl: "http://x", codexConnected: false, deviceCount: 0 } })).toBe(COLORS.starting);
    expect(trayColor({ kind: "stopped" })).toBe(COLORS.stopped);
    expect(trayColor({ kind: "error", message: "x" })).toBe(COLORS.error);
  });
});

describe("relativeTime", () => {
  it("rounds to the most useful unit", () => {
    expect(relativeTime(NOW - 20_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe("5 min ago");
    expect(relativeTime(NOW - 3 * 60 * MIN, NOW)).toBe("3 h ago");
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe("2 d ago");
    expect(relativeTime(NOW - 40 * DAY, NOW)).toBe("2026-08-12");
  });
});

describe("staleDevices", () => {
  it("picks phones not seen for a week", () => {
    const devices = [device("old", "iPhone", NOW - 8 * DAY), device("edge", "iPhone", NOW - 7 * DAY + MIN), device("new", "iPhone", NOW)];
    expect(staleDevices(devices, NOW).map((d) => d.id)).toEqual(["old"]);
  });
});

describe("trayTooltip", () => {
  it("names the state", () => {
    expect(trayTooltip({ kind: "stopped" })).toBe("Codex Pocket: stopped");
    expect(trayTooltip({ kind: "running", status: { publicUrl: "http://x", codexConnected: true, deviceCount: 0 } })).toBe("Codex Pocket: http://x");
  });
});
