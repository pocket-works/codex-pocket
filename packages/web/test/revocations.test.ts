// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerRegistry } from "../src/state/computers.js";
import { retryPendingRevocations } from "../src/state/revocations.js";

let registry: ComputerRegistry;

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}')));
  registry = new ComputerRegistry(localStorage, "https://entry.ts.net");
  const computer = registry.add("https://mac.ts.net", { instanceId: "mac", host: "Mac", token: "old-token", deviceId: "phone" });
  registry.remove(computer.id, true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pending revocations", () => {
  it("revokes with the retained token and clears the pending record", async () => {
    await retryPendingRevocations(registry);
    expect(fetch).toHaveBeenCalledWith("https://mac.ts.net/api/device", expect.objectContaining({
      method: "DELETE",
      headers: expect.any(Headers),
    }));
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer old-token");
    expect(registry.store.get().pendingRevocations).toEqual([]);
  });

  it("settles the pending record when the token is already invalid", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await retryPendingRevocations(registry);
    expect(registry.store.get().pendingRevocations).toEqual([]);
  });

  it("keeps the pending record while the computer remains unreachable", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    await retryPendingRevocations(registry);
    expect(registry.store.get().pendingRevocations).toHaveLength(1);
  });

  it("keeps the pending record after a retryable HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 403 }));
    await retryPendingRevocations(registry);
    expect(registry.store.get().pendingRevocations).toHaveLength(1);
  });

  it("survives a reload without exposing the removed computer in the main list", () => {
    const restored = new ComputerRegistry(localStorage, "https://entry.ts.net");
    expect(restored.store.get().computers).toEqual([]);
    expect(restored.store.get().pendingRevocations).toHaveLength(1);
    expect(restored.store.get().pendingRevocations[0].token).toBe("old-token");
  });
});
