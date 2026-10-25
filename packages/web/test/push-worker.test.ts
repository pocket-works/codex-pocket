import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("computer notification worker", () => {
  it.each([false, true])("keeps its own computer identity and signals the page even if navigation rejects (%s)", async (rejectNavigation) => {
    const handlers = new Map<string, (event: any) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    if (rejectNavigation) navigate.mockRejectedValue(new Error("Navigation failed"));
    const focus = vi.fn().mockResolvedValue(undefined);
    const postMessage = vi.fn();
    const put = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ put }) });
    vi.stubGlobal("location", { href: "https://entry.ts.net/push-worker.js?computer=b&name=Home%20Mac", origin: "https://entry.ts.net" });
    vi.stubGlobal("addEventListener", (type: string, handler: (event: any) => void) => handlers.set(type, handler));
    vi.stubGlobal("registration", { showNotification });
    vi.stubGlobal("clients", { matchAll: vi.fn().mockResolvedValue([{ url: "https://entry.ts.net/#/h/a/", navigate, focus, postMessage }]), openWindow: vi.fn() });
    await import("../src/push-worker.js");
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get("push")!({ data: { json: () => ({ title: "Finished", threadId: "same/thread", computerId: "a" }) }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("Home Mac · Finished", expect.objectContaining({ tag: "b:same/thread", data: { computerId: "b", threadId: "same/thread" } }));
    handlers.get("notificationclick")!({ notification: { close: vi.fn(), data: { threadId: "same/thread", computerId: "a" } }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
    expect(navigate).toHaveBeenCalledWith("https://entry.ts.net/#/h/b/t/same%2Fthread");
    expect(focus).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: "notification-open" });
    expect(await (put.mock.calls[0][1] as Response).json()).toEqual({ url: "https://entry.ts.net/#/h/b/t/same%2Fthread", clickedAt: expect.any(Number) });
  });
});
