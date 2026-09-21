import { describe, expect, it } from "vitest";
import { buildMenu, trayTooltip, type MenuItem } from "../src/menu.js";

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
    const m = buildMenu({ kind: "running", status: { publicUrl: "http://10.0.0.2:7333", codexConnected: true, deviceCount: 1 } }, [{ id: "d1", name: "Pixel", createdAt: 0, lastSeenAt: null }]);
    expect(labels(m).slice(0, 2)).toEqual(["Host running at http://10.0.0.2:7333", "Codex daemon: connected"]);
    expect(byAction(m, "pair")?.enabled).toBe(true);
    expect(byAction(m, "stop")).toBeDefined();
    const devices = items(m).find((i) => i.label === "1 paired phone");
    expect(devices?.submenu?.[0].label).toBe("Pixel");
    expect(devices?.submenu?.[0].submenu?.at(-1)?.action).toEqual({ revoke: "d1" });
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

  it("always ends with Quit", () => {
    expect(items(buildMenu({ kind: "starting" }, [])).at(-1)?.action).toBe("quit");
  });
});

describe("trayTooltip", () => {
  it("names the state", () => {
    expect(trayTooltip({ kind: "stopped" })).toBe("Codex Pocket: stopped");
    expect(trayTooltip({ kind: "running", status: { publicUrl: "http://x", codexConnected: true, deviceCount: 0 } })).toBe("Codex Pocket: http://x");
  });
});
