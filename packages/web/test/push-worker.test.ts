import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("computer notification worker", () => {
  it("routes a notification using its own scope identity instead of the sender's computer id", async () => {
    const handlers = new Map<string, (event: any) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    const focus = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("location", { href: "https://entry.ts.net/push-worker.js?computer=b&name=Home%20Mac", origin: "https://entry.ts.net" });
    vi.stubGlobal("addEventListener", (type: string, handler: (event: any) => void) => handlers.set(type, handler));
    vi.stubGlobal("registration", { showNotification });
    vi.stubGlobal("clients", { matchAll: vi.fn().mockResolvedValue([{ url: "https://entry.ts.net/#/h/a/", navigate, focus }]), openWindow: vi.fn() });
    await import("../src/push-worker.js");
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get("push")!({ data: { json: () => ({ title: "Finished", threadId: "same/thread", computerId: "a" }) }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("Home Mac · Finished", expect.objectContaining({ tag: "b:same/thread", data: { computerId: "b", threadId: "same/thread" } }));
    handlers.get("notificationclick")!({ notification: { close: vi.fn(), data: { threadId: "same/thread", computerId: "a" } }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
    expect(navigate).toHaveBeenCalledWith("https://entry.ts.net/#/h/b/t/same%2Fthread");
    expect(focus).toHaveBeenCalledOnce();
  });
});
