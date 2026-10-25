// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenForNotificationNavigation, restoreNotificationRoute } from "../src/state/notification-navigation.js";

const origin = "https://entry.test";
const destination = `${origin}/#/h/other-computer/t/thread%2Fone`;
let pending: string | null;
let cleanup: (() => void) | undefined;
let worker: EventTarget;
let currentLocation: { origin: string; hash: string };

beforeEach(() => {
  pending = JSON.stringify({ url: destination, clickedAt: Date.now() });
  currentLocation = { origin, hash: "#/h/current/t/previous?pocket=computers" };
  vi.stubGlobal("location", currentLocation);
  vi.spyOn(history, "replaceState").mockImplementation((_data, _unused, url) => {
    currentLocation.hash = new URL(String(url)).hash;
  });
  vi.stubGlobal("caches", { open: vi.fn(async () => ({
    match: async () => pending ? new Response(pending) : undefined,
    delete: async () => { pending = null; return true; },
  })) });
  worker = new EventTarget();
  vi.stubGlobal("navigator", { serviceWorker: worker });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("notification destination recovery", () => {
  it("restores the target on cold startup when the browser opened the previous page", async () => {
    const changed = vi.fn();
    window.addEventListener("hashchange", changed);
    try {
      await restoreNotificationRoute();
      expect(currentLocation.hash).toBe(new URL(destination).hash);
      expect(changed).toHaveBeenCalledOnce();
      expect(pending).toBeNull();
      await restoreNotificationRoute();
      expect(changed).toHaveBeenCalledOnce();
    } finally { window.removeEventListener("hashchange", changed); }
  });

  it.each(["focus", "visibilitychange", "message"])("recovers on %s when an existing window is only focused", async (event) => {
    cleanup = listenForNotificationNavigation();
    if (event === "message") worker.dispatchEvent(new MessageEvent("message", { data: { type: "notification-open" } }));
    else if (event === "focus") window.dispatchEvent(new Event(event));
    else document.dispatchEvent(new Event(event));
    await vi.waitFor(() => expect(currentLocation.hash).toBe(new URL(destination).hash));
    expect(pending).toBeNull();
  });

  it.each([
    { url: "https://external.test/#/t/thread", clickedAt: Date.now() },
    { url: `${origin}/#/t/old`, clickedAt: Date.now() - 6 * 60_000 },
    { url: `${origin}/api/me#/t/thread`, clickedAt: Date.now() },
  ])("discards an invalid or expired destination: %j", async (data) => {
    pending = JSON.stringify(data);
    await restoreNotificationRoute();
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(pending).toBeNull();
  });

  it("still accepts a later click after reading a malformed cache entry", async () => {
    pending = "not JSON";
    await restoreNotificationRoute();
    pending = JSON.stringify({ url: destination, clickedAt: Date.now() });
    await restoreNotificationRoute();
    expect(currentLocation.hash).toBe(new URL(destination).hash);
  });
});
