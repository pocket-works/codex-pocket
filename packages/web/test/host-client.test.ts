import { afterEach, describe, expect, it, vi } from "vitest";
import { HostClient } from "../src/state/host-client.js";
import type { Computer } from "../src/state/computers.js";

const computer = (id: string): Computer => ({ id, name: id, origin: `https://${id}.ts.net`, instanceId: id, token: `${id}-token`, deviceId: id, lastRoute: "#/", notifications: false });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("computer-bound HTTP client", () => {
  it("supports aborting requests on browsers without AbortSignal.any", async () => {
    vi.stubGlobal("AbortSignal", { timeout: AbortSignal.timeout.bind(AbortSignal) });
    const request = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", request);
    const host = new HostClient(computer("a"));
    const caller = new AbortController();
    await host.fetch("/api/me", { signal: caller.signal });
    caller.abort();
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    await host.fetch("/api/me");
    host.dispose();
    expect(request.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it("keeps credentials at their original target after the profile changes", async () => {
    const request = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", request);
    const profile = computer("a");
    const a = new HostClient(profile);
    const b = new HostClient(computer("b"));
    profile.origin = b.origin;
    profile.token = "changed";
    await a.fetch("/api/uploads");
    await b.fetch("/api/me");
    expect(request.mock.calls[0][0]).toBe("https://a.ts.net/api/uploads");
    expect(request.mock.calls[0][1].headers.get("authorization")).toBe("Bearer a-token");
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(request.mock.calls[1][1].headers.get("authorization")).toBe("Bearer b-token");
    a.dispose(); b.dispose();
  });

  it("aborts only the disposed computer's pending requests", async () => {
    const request = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", request);
    const a = new HostClient(computer("a"));
    const b = new HostClient(computer("b"));
    await a.fetch("/api/me"); await b.fetch("/api/me");
    a.dispose();
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    expect(request.mock.calls[1][1].signal.aborted).toBe(false);
    b.dispose();
  });

  it("does not reuse cached metadata across hosts or accept changed identity", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ instanceId: "a", host: "A" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ instanceId: "wrong", host: "B" })));
    vi.stubGlobal("fetch", request);
    const a = new HostClient(computer("a")); const b = new HostClient(computer("b"));
    expect((await a.me()).host).toBe("A");
    expect((await a.me()).host).toBe("A");
    await expect(b.me()).rejects.toThrow("identity changed");
    expect(request).toHaveBeenCalledTimes(2);
    a.dispose(); b.dispose();
  });
});
