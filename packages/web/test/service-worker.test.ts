import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformWithEsbuild } from "vite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const assets = ["/", "/assets/index-test.js", "/assets/index-test.css", "/assets/QrScanner-test.js"];
let code: string;

beforeAll(async () => {
  ({ code } = await transformWithEsbuild(readFileSync(new URL("../src/sw.ts", import.meta.url), "utf8"), "sw.ts", {
    format: "iife",
    define: { __SHELL_VERSION__: JSON.stringify("test"), __SHELL_ASSETS__: JSON.stringify(assets) },
  }));
});

afterEach(() => vi.useRealTimers());

function harness() {
  const listeners = new Map<string, (event: unknown) => void>();
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(true) };
  const self = {
    location: { origin: "https://mac.test" },
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined), matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn().mockResolvedValue(undefined) },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
  };
  const fetch = vi.fn().mockRejectedValue(new Error("Host stopped"));
  runInNewContext(code, { self, caches, fetch, AbortController, setTimeout, clearTimeout, URL, Response });

  function lifecycle(name: string, event: Record<string, unknown> = {}): Promise<void> {
    let done!: Promise<void>;
    listeners.get(name)!({ ...event, waitUntil: (work: Promise<void>) => { done = work; } });
    return done;
  }

  function request(path: string, options: { mode?: string; cache?: string; method?: string } = {}) {
    let response: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    listeners.get("fetch")!({
      request: { url: new URL(path, self.location.origin).href, mode: "cors", cache: "default", method: "GET", ...options },
      respondWith: (work: Promise<Response>) => { response = work; },
      waitUntil: (work: Promise<unknown>) => pending.push(work),
    });
    return { response, pending };
  }

  return { cache, caches, self, fetch, lifecycle, request };
}

describe("offline app shell", () => {
  it("keeps computer metadata used by notifications", async () => {
    const h = harness();
    await h.lifecycle("message", { data: { type: "legacy-computer", id: "mac-one", name: "Work Mac" } });
    expect(h.caches.open).toHaveBeenCalledWith("codex-pocket-metadata");
    const [key, response] = h.cache.put.mock.calls[0] as [string, Response];
    expect(key).toBe("/__pocket-legacy-computer");
    expect(await response.json()).toEqual({ id: "mac-one", name: "Work Mac" });
  });

  it("keeps the computer ID in push notifications", async () => {
    const h = harness();
    h.cache.match.mockResolvedValue(new Response(JSON.stringify({ id: "mac-one" })));
    await h.lifecycle("push", { data: { json: () => ({ title: "Codex", body: "Done", threadId: "thread-one" }) } });
    expect(h.self.registration.showNotification).toHaveBeenCalledWith("Codex", expect.objectContaining({ data: { threadId: "thread-one", computerId: "mac-one" } }));
  });

  it("opens notification threads on the correct computer", async () => {
    const h = harness();
    await h.lifecycle("notificationclick", { notification: { close: vi.fn(), data: { threadId: "thread/one", computerId: "mac one" } } });
    expect(h.self.clients.openWindow).toHaveBeenCalledWith("/#/h/mac%20one/t/thread%2Fone");
  });

  it("preloads HTML, CSS, entry and lazy bundles before taking control", async () => {
    const h = harness();
    await h.lifecycle("install");
    expect(h.cache.addAll).toHaveBeenCalledWith(assets);
    expect(h.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it("keeps the existing worker when part of the shell cannot be cached", async () => {
    const h = harness();
    h.cache.addAll.mockRejectedValue(new Error("Missing bundle"));
    await expect(h.lifecycle("install")).rejects.toThrow("Missing bundle");
    expect(h.self.skipWaiting).not.toHaveBeenCalled();
    expect(h.caches.delete).not.toHaveBeenCalled();
  });

  it("only removes older Pocket shell caches", async () => {
    const h = harness();
    h.caches.keys.mockResolvedValue(["codex-pocket-shell-v2", "codex-pocket-shell-test", "codex-pocket-metadata", "another-app"]);
    await h.lifecycle("activate");
    expect(h.caches.delete.mock.calls).toEqual([["codex-pocket-shell-v2"]]);
    expect(h.self.clients.claim).toHaveBeenCalledOnce();
  });

  it.each(["/", "/thread/deep-link"])("opens cached HTML at %s when the host is stopped", async (path) => {
    const h = harness();
    const shell = new Response("App shell");
    h.cache.match.mockResolvedValue(shell);
    expect(await h.request(path, { mode: "navigate" }).response).toBe(shell);
    expect(h.cache.match).toHaveBeenCalledWith("/");
  });

  it("opens cached HTML when the proxy returns an error page", async () => {
    const h = harness();
    const shell = new Response("App shell");
    h.cache.match.mockResolvedValue(shell);
    h.fetch.mockResolvedValue(new Response("Bad gateway", { status: 502 }));
    expect(await h.request("/", { mode: "navigate" }).response).toBe(shell);
  });

  it("still falls back for navigations that bypass the HTTP cache", async () => {
    const h = harness();
    const shell = new Response("App shell");
    h.cache.match.mockResolvedValue(shell);
    expect(await h.request("/", { mode: "navigate", cache: "no-store" }).response).toBe(shell);
  });

  it("limits a hanging host request to three seconds", async () => {
    vi.useFakeTimers();
    const h = harness();
    const shell = new Response("App shell");
    h.cache.match.mockResolvedValue(shell);
    h.fetch.mockImplementation((_: unknown, { signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Timed out")));
    }));
    const { response } = h.request("/", { mode: "navigate" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await response).toBe(shell);
  });

  it("serves cached bundles without contacting the stopped host", async () => {
    const h = harness();
    const script = new Response("JavaScript");
    h.cache.match.mockResolvedValue(script);
    expect(await h.request("/assets/index-test.js").response).toBe(script);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("does not substitute HTML for an uncached bundle", async () => {
    const h = harness();
    await expect(h.request("/assets/missing.js").response).rejects.toThrow("Host stopped");
    expect(h.cache.match).not.toHaveBeenCalledWith("/");
  });

  it("keeps the installed shell intact while serving newer HTML online", async () => {
    const h = harness();
    const fresh = new Response("New app shell");
    h.fetch.mockResolvedValue(fresh);
    expect(await h.request("/", { mode: "navigate" }).response).toBe(fresh);
    expect(h.cache.put).not.toHaveBeenCalled();
  });

  it("waits for runtime bundle cache writes to finish", async () => {
    const h = harness();
    h.fetch.mockResolvedValue(new Response("Lazy bundle"));
    const result = h.request("/assets/new.js");
    await result.response;
    expect(result.pending).toHaveLength(1);
    await Promise.all(result.pending);
    expect(h.cache.put).toHaveBeenCalledOnce();
  });

  it.each([
    ["/api/me", {}], ["/api/pair", { method: "POST" }], ["/ws", {}],
    ["/", { cache: "no-store" }], ["https://external.test/image.png", {}],
  ])("leaves %s requests to the network (%j)", (path, options) => {
    const h = harness();
    expect(h.request(path, options).response).toBeUndefined();
    expect(h.caches.open).not.toHaveBeenCalled();
  });
});
