// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerRegistry } from "../src/state/computers.js";
import { disablePush, enablePush, pushStatus, type PushStatus } from "../src/state/push.js";
import { Pocket } from "../src/ui/Pocket.js";
import { computerRouteHash, readPocketPanel } from "../src/ui/route.js";

const lifecycle = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock("../src/ui/App.js", async () => {
  const { createElement, useEffect, useState } = await import("react");
  const { useComputers } = await import("../src/ui/ComputerContext.js");
  return { App: () => {
    const computers = useComputers()!;
    const [draft, setDraft] = useState("");
    useEffect(() => { lifecycle.mounted(); return () => { lifecycle.unmounted(); }; }, []);
    return createElement("main", null,
      createElement("h1", null, "Test chat"),
      createElement("textarea", { value: draft, onChange: (event: { target: { value: string } }) => setDraft(event.target.value) }),
      createElement("button", { onClick: () => computers.manage() }, "Computers"),
      createElement("button", { onClick: computers.about }, "About"),
    );
  } };
});
vi.mock("../src/state/session.js", async () => {
  const { createStore } = await import("../src/state/store.js");
  return { Session: class {
    store = createStore({ connection: "open", upstreamConnected: true });
    operations = createStore(0);
    constructor(readonly rpc: unknown, readonly host: { dispose: () => void }) {}
    start() {}
    dispose() { this.host.dispose(); }
  } };
});
vi.mock("../src/state/push.js", () => ({ pushStatus: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(), forgetPush: vi.fn().mockResolvedValue(undefined) }));

let container: HTMLDivElement;
let root: Root;
let registry: ComputerRegistry;
let workId: string;
let homeId: string;
let subscriptions: Map<string, PushStatus>;
let currentLocation: { origin: string; hostname: string; hash: string };

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  currentLocation = { origin: "https://work.ts.net", hostname: "work.ts.net", hash: "" };
  vi.stubGlobal("location", currentLocation);
  const entries: { hash: string; state: unknown }[] = [{ hash: "", state: null }];
  let position = 0;
  const entry = (state: unknown, url?: string | URL | null) => ({ state, hash: url ? new URL(String(url), currentLocation.origin).hash : currentLocation.hash });
  vi.stubGlobal("history", {
    get state() { return entries[position].state; },
    get length() { return entries.length; },
    pushState(state: unknown, _unused: string, url?: string | URL | null) { entries.splice(position + 1); entries.push(entry(state, url)); currentLocation.hash = entries[++position].hash; },
    replaceState(state: unknown, _unused: string, url?: string | URL | null) { entries[position] = entry(state, url); currentLocation.hash = entries[position].hash; },
    back() { if (position > 0) { currentLocation.hash = entries[--position].hash; window.dispatchEvent(new Event("hashchange")); } },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({
    host: "Mac", upstream: true, apiVersion: 2,
    instanceId: url.startsWith("https://work") ? "work" : "home",
    device: { id: url.startsWith("https://work") ? "work-phone" : "home-phone", name: "Test phone", createdAt: 1_700_000_000_000, push: false },
  }))));
  registry = new ComputerRegistry(localStorage, currentLocation.origin);
  workId = registry.add(currentLocation.origin, { instanceId: "work", host: "Work Mac", token: "work-token", deviceId: "work-phone" }).id;
  homeId = registry.add("https://home.ts.net", { instanceId: "home", host: "Home Mac", token: "home-token", deviceId: "home-phone" }).id;
  registry.select(workId);
  currentLocation.hash = computerRouteHash(workId, "#/t/task");
  history.replaceState(null, "", `/${currentLocation.hash}`);
  subscriptions = new Map([[workId, "off"], [homeId, "off"]]);
  vi.mocked(pushStatus).mockReset().mockImplementation(async (host) => subscriptions.get(host.id)!);
  vi.mocked(enablePush).mockReset().mockImplementation(async (host) => { subscriptions.set(host.id, "on"); return "on"; });
  vi.mocked(disablePush).mockReset().mockImplementation(async (host) => { subscriptions.set(host.id, "off"); return "off"; });
  lifecycle.mounted.mockClear(); lifecycle.unmounted.mockClear();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const mount = () => act(async () => root.render(createElement(Pocket, { registry })));
const click = (button: Element) => act(async () => (button as HTMLButtonElement).click());
const named = (name: string, scope: ParentNode = container) => Array.from(scope.querySelectorAll("button")).find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name)!;
const screen = () => container.querySelector(".computer-screen")!;
const detailSwitch = () => screen().querySelector('[role="switch"]')!;
async function details(name = "Work Mac") { await click(named("Computers")); await click(named(`Details for ${name}`)); }

describe("Computer navigation", () => {
  it("returns from details to the original chat without remounting it or remembering management pages", async () => {
    await mount();
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Unsent message");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await details();
    expect(container.querySelector(".pocket-workspace")!.hasAttribute("hidden")).toBe(true);
    expect(registry.active!.lastRoute).toBe("#/t/task");
    await click(named("Back", screen()));
    expect(readPocketPanel(currentLocation.hash)).toEqual({ name: "computers" });
    await act(async () => history.back());
    expect(readPocketPanel(currentLocation.hash)).toBeNull();
    expect(currentLocation.hash).toBe(computerRouteHash(workId, "#/t/task"));
    expect(container.querySelector(".pocket-workspace")!.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector("textarea")!.value).toBe("Unsent message");
    expect(lifecycle.mounted).toHaveBeenCalledOnce();
    expect(lifecycle.unmounted).not.toHaveBeenCalled();
  });

  it("restores a computer's notification preference when details is reopened", async () => {
    subscriptions.set(workId, "on");
    await mount(); await details();
    expect(registry.active!.notifications).toBe(true);
    await click(detailSwitch());
    expect(registry.active!.notifications).toBe(false);
    await click(named("Back", screen()));
    await click(named("Details for Work Mac"));
    expect(detailSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("only changes notifications for the computer shown in details", async () => {
    await mount(); await details("Home Mac");
    await click(detailSwitch());
    expect(registry.store.get().computers.find((c) => c.id === homeId)!.notifications).toBe(true);
    expect(registry.active!.notifications).toBe(false);
    expect(screen().querySelector("h1")!.textContent).toBe("Home Mac");
    expect(named("Use this computer", screen())).toBeDefined();
  });

  it("ignores a late notification read after opening another computer's details", async () => {
    let finish!: (status: PushStatus) => void;
    vi.mocked(pushStatus).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    subscriptions.set(homeId, "on");
    await mount(); await details();
    expect(screen().querySelector('[role="switch"]')).toBeNull();
    await click(named("Back", screen()));
    await click(named("Details for Home Mac"));
    await act(async () => finish("off"));
    expect(detailSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("saves notifications when an operation finishes after details closes", async () => {
    let finish!: () => void;
    vi.mocked(enablePush).mockImplementationOnce((host) => new Promise((resolve) => {
      finish = () => { subscriptions.set(host.id, "on"); resolve("on"); };
    }));
    await mount(); await details(); await click(detailSwitch());
    await click(named("Back", screen()));
    await act(async () => finish());
    expect(registry.active!.notifications).toBe(true);
    await click(named("Details for Work Mac"));
    expect(detailSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("offers a retry when notification status cannot be read", async () => {
    vi.mocked(pushStatus).mockRejectedValueOnce(new Error("Read failed"));
    await mount(); await details();
    expect(screen().querySelector('[role="alert"]')!.textContent).toContain("Read failed");
    await click(named("Retry notification status"));
    expect(detailSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("prevents switching and pairing during a send or upload", async () => {
    await mount();
    const session = (window as unknown as { codexPocket: { session: { operations: { set: (value: number) => void } } } }).codexPocket.session;
    await act(async () => session.operations.set(1));
    await click(named("Computers"));
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>(".computer-choice")).every((button) => button.disabled)).toBe(true);
    expect((named("Add computer") as HTMLButtonElement).disabled).toBe(true);
    await click(named("Details for Work Mac"));
    expect((named("Pair again") as HTMLButtonElement).disabled).toBe(true);
    expect((named("Remove computer") as HTMLButtonElement).disabled).toBe(true);
  });

  it("returns from pairing to details without switching computers", async () => {
    await mount(); await details();
    await click(named("Pair again"));
    expect(screen().querySelector("h1")!.textContent).toBe("Pair again");
    await click(named("Back", screen()));
    expect(screen().querySelector("h1")!.textContent).toBe("Work Mac");
    expect(registry.active!.id).toBe(workId);
    expect(lifecycle.unmounted).not.toHaveBeenCalled();
  });

  it("shows pairing recovery for revoked access without losing the current chat", async () => {
    await mount(); await click(named("Computers"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await click(named("Details for Work Mac"));
    expect(screen().textContent).toContain("Pair again");
    expect(screen().querySelector(".topbar-title .small")!.textContent).toContain("Pair again");
    expect(registry.active!.id).toBe(workId);
    expect(lifecycle.unmounted).not.toHaveBeenCalled();
  });

  it("handles a removed computer's detail link without opening a new pairing flow", async () => {
    currentLocation.hash = `${computerRouteHash(workId, "#/t/task")}?pocket=pair&computer=removed`;
    await mount();
    expect(container.textContent).toContain("This computer is no longer paired.");
    expect(container.querySelector(".pair-inline")).toBeNull();
    expect(registry.store.get().computers).toHaveLength(2);
  });

  it("offers local removal when an unreachable computer cannot revoke access", async () => {
    await mount(); await details();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    await click(named("Remove computer"));
    expect(screen().querySelector('[role="alert"]')!.textContent).toContain("Local removal leaves its pairing");
    expect(registry.store.get().computers).toHaveLength(2);
    await click(named("Remove locally"));
    expect(registry.store.get().computers).toHaveLength(1);
    expect(registry.active!.id).toBe(homeId);
    expect(readPocketPanel(currentLocation.hash)).toBeNull();
  });

  it("keeps About independent of the selected computer", async () => {
    await mount(); await click(named("About"));
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain("Phone app version");
    expect(registry.active!.lastRoute).toBe("#/t/task");
    await click(named("Close"));
    expect(lifecycle.mounted).toHaveBeenCalledOnce();
  });
});
