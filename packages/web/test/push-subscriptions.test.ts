import { afterEach, describe, expect, it, vi } from "vitest";
import { HostClient } from "../src/state/host-client.js";
import { disablePush, enablePush, pushStatus } from "../src/state/push.js";

afterEach(() => vi.unstubAllGlobals());

describe("computer push subscriptions", () => {
  it("uses each host's VAPID key and token, and disabling one preserves the other", async () => {
    const regs = new Map<string, any>();
    const register = vi.fn(async (_script: string, { scope }: { scope: string }) => {
      const url = `https://entry.ts.net${scope}`;
      let sub: any = null;
      const reg = {
        scope: url, active: {},
        pushManager: {
          getSubscription: vi.fn(async () => sub),
          subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
            sub = { options: { applicationServerKey }, unsubscribe: vi.fn(async () => { sub = null; return true; }), toJSON: () => ({ endpoint: `https://push.example${scope}`, keys: { auth: "auth", p256dh: "key" } }) };
            return sub;
          }),
        },
        unregister: vi.fn(async () => regs.delete(url)),
      };
      regs.set(url, reg);
      return reg;
    });
    vi.stubGlobal("navigator", { userAgent: "browser", serviceWorker: { register, getRegistration: async (scope: string) => regs.get(scope) } });
    vi.stubGlobal("window", { PushManager: {}, Notification: {} });
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: async () => "granted" });
    vi.stubGlobal("location", { origin: "https://entry.ts.net" });
    const request = vi.fn(async (url: string, _options?: RequestInit) => new Response(JSON.stringify(url.endsWith("/vapid") ? { publicKey: url.includes("a.ts.net") ? "AQ" : "Ag" } : { ok: true })));
    vi.stubGlobal("fetch", request);
    const host = (id: string) => new HostClient({ id, instanceId: id, name: id, token: `${id}-token`, deviceId: id, origin: `https://${id}.ts.net`, lastRoute: "#/", notifications: false });
    const a = host("a"); const b = host("b");
    expect(await enablePush(a)).toBe("on");
    expect(await enablePush(b)).toBe("on");
    const aReg = regs.get("https://entry.ts.net/push/a/");
    const bReg = regs.get("https://entry.ts.net/push/b/");
    expect([...aReg.pushManager.subscribe.mock.calls[0][0].applicationServerKey]).toEqual([1]);
    expect([...bReg.pushManager.subscribe.mock.calls[0][0].applicationServerKey]).toEqual([2]);
    const puts = request.mock.calls.filter(([, options]) => options?.method === "PUT");
    expect(puts.map(([url, options]) => [url, new Headers(options?.headers).get("authorization"), JSON.parse(String(options?.body)).endpoint])).toEqual([
      ["https://a.ts.net/api/push/subscription", "Bearer a-token", "https://push.example/push/a/"],
      ["https://b.ts.net/api/push/subscription", "Bearer b-token", "https://push.example/push/b/"],
    ]);
    expect(await disablePush(a)).toBe("off");
    expect(aReg.unregister).toHaveBeenCalledOnce();
    expect(bReg.unregister).not.toHaveBeenCalled();
    expect(await pushStatus(a)).toBe("off");
    expect(await pushStatus(b)).toBe("on");
    a.dispose(); b.dispose();
  });
});
