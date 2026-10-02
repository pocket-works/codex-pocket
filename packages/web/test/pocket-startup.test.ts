// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerRegistry } from "../src/state/computers.js";
import { enablePush } from "../src/state/push.js";
import { Pocket } from "../src/ui/Pocket.js";
import { computerRouteHash } from "../src/ui/route.js";

vi.mock("../src/ui/App.js", () => ({ App: () => null }));
vi.mock("../src/state/push.js", () => ({ enablePush: vi.fn().mockResolvedValue("on") }));
vi.mock("../src/state/session.js", async () => {
  const { createStore } = await import("../src/state/store.js");
  return { Session: class {
    store = createStore({ connection: "open", upstreamConnected: true });
    constructor(readonly rpc: unknown, readonly host: { dispose: () => void }) {}
    start() {}
    dispose() { this.host.dispose(); }
  } };
});

let container: HTMLDivElement;
let root: Root;
let registry: ComputerRegistry;
let entryId: string;
let secondId: string;
let currentLocation: { origin: string; hash: string };

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  currentLocation = { origin: "https://entry.ts.net", hash: "" };
  vi.stubGlobal("location", currentLocation);
  vi.spyOn(history, "replaceState").mockImplementation((_data, _unused, url) => {
    currentLocation.hash = new URL(String(url), currentLocation.origin).hash;
  });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify({
    instanceId: url.startsWith(currentLocation.origin) ? "entry" : "second",
    device: { id: "device", push: false }, apiVersion: 2,
  }))));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  registry = new ComputerRegistry(localStorage, currentLocation.origin);
  entryId = registry.add(currentLocation.origin, { instanceId: "entry", token: "entry-token", deviceId: "entry-device" }).id;
  secondId = registry.add("https://second.ts.net", { instanceId: "second", token: "second-token", deviceId: "second-device" }).id;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  vi.mocked(enablePush).mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const mount = () => act(async () => root.render(createElement(Pocket, { registry })));

describe("PWA startup", () => {
  it("restores the active computer's remembered page when launched from the manifest", async () => {
    registry.update(secondId, { lastRoute: "#/t/second-thread" });
    await mount();
    expect(registry.active!.id).toBe(secondId);
    expect(currentLocation.hash).toBe(computerRouteHash(secondId, "#/t/second-thread"));
  });

  it("opens legacy thread links on the entry computer", async () => {
    currentLocation.hash = "#/t/legacy-thread";
    await mount();
    expect(registry.active!.id).toBe(entryId);
    expect(currentLocation.hash).toBe(computerRouteHash(entryId, "#/t/legacy-thread"));
  });

  it("does not re-enable disabled notifications when the app wakes", async () => {
    registry.update(secondId, { notifications: true });
    await mount();
    expect(enablePush).toHaveBeenCalledOnce();
    await act(async () => registry.update(secondId, { notifications: false }));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(enablePush).toHaveBeenCalledOnce();
  });
});
