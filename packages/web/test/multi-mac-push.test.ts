import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformWithEsbuild } from "vite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DeviceStore } from "../../host/src/auth/device-store.js";
import { PushNotifier } from "../../host/src/push/notifier.js";
import { parseRoute, routeComputer } from "../src/ui/route.js";

const origin = "https://entry.test";
const title = "Fix login";
const temporaryDirectories: string[] = [];
let workerCode: string;

beforeAll(async () => {
  ({ code: workerCode } = await transformWithEsbuild(
    readFileSync(new URL("../src/push-worker.ts", import.meta.url), "utf8"),
    "push-worker.ts", { format: "iife" },
  ));
});

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

type Alert = { title: string; options: NotificationOptions; close: ReturnType<typeof vi.fn> };
type WindowClient = { url: string; navigate: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> };

function phone() {
  const alerts = new Map<string, Alert>();
  const windows: WindowClient[] = [];
  const openWindow = vi.fn(async (url: string) => {
    const client: WindowClient = {
      url,
      navigate: vi.fn(async (next: string) => { client.url = next; return client; }),
      focus: vi.fn(async () => client),
    };
    windows.push(client);
    return client;
  });
  const clients = { matchAll: vi.fn(async () => [...windows]), openWindow };

  function worker(computerId: string, name: string) {
    const listeners = new Map<string, (event: unknown) => void>();
    // Each registration has a separate global scope, as on the installed PWA.
    runInNewContext(workerCode, {
      URL,
      location: { origin, href: `${origin}/push-worker.js?computer=${encodeURIComponent(computerId)}&name=${encodeURIComponent(name)}` },
      clients,
      addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
      registration: {
        showNotification: async (heading: string, options: NotificationOptions) => {
          const alert = { title: heading, options, close: vi.fn(() => alerts.delete(options.tag!)) };
          alerts.set(options.tag!, alert);
        },
      },
    });
    async function dispatch(type: string, event: Record<string, unknown>) {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)!({ ...event, waitUntil: (work: Promise<unknown>) => pending.push(work) });
      await Promise.all(pending);
    }
    return {
      push: (payload: string) => dispatch("push", { data: { json: () => JSON.parse(payload) } }),
      click: (alert: Alert) => dispatch("notificationclick", { notification: { data: alert.options.data, close: alert.close } }),
    };
  }
  return { alerts, windows, clients, worker };
}

const scenarios = [false, true].flatMap((sharedThreadId) =>
  [false, true].flatMap((closeBetweenClicks) =>
    [false, true].map((reverse) => ({ sharedThreadId, closeBetweenClicks, reverse })),
  ),
);

describe("multi-Mac push simulation", () => {
  it.each(scenarios)("opens same-title alerts on their own Mac/thread: %j", async ({ sharedThreadId, closeBetweenClicks, reverse }) => {
    const pwa = phone();
    const directory = mkdtempSync(join(tmpdir(), "cp-multi-mac-push-"));
    temporaryDirectories.push(directory);
    const computers = [
      { id: "mac-a", name: "Work Mac", threadId: sharedThreadId ? "same/thread" : "thread/a" },
      { id: "mac-b", name: "Home Mac", threadId: sharedThreadId ? "same/thread" : "thread/b" },
    ];
    const deliveries: { endpoint: string; payload: string }[] = [];
    const hosts = await Promise.all(computers.map(async (computer) => {
      const store = new DeviceStore(join(directory, computer.id, "devices.json"));
      const device = (await store.redeemPairingCode(store.createPairingCode(), "Test iPhone"))!;
      const endpoint = `https://push.test/${computer.id}`;
      await store.setPushSubscription(device.deviceId, { endpoint, keys: { p256dh: "test-key", auth: "test-auth" } });
      const worker = pwa.worker(computer.id, computer.name);
      const notifier = new PushNotifier({
        store,
        threadTitle: async () => title,
        send: async (subscription, payload) => {
          expect(subscription.endpoint).toBe(endpoint);
          deliveries.push({ endpoint: subscription.endpoint, payload });
          await worker.push(payload);
        },
      });
      // The PWA was viewing this thread before closing and disconnecting.
      notifier.setClientState("pwa", device.deviceId, { visible: true, threadId: computer.threadId });
      notifier.clearClient("pwa");
      return notifier;
    }));

    expect(pwa.windows).toHaveLength(0);
    await Promise.all(hosts.map((host, index) => host.handle({
      jsonrpc: "2.0", method: "turn/completed",
      params: { threadId: computers[index].threadId, turn: { id: "turn", status: "completed" } },
    })));
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map(({ payload }) => JSON.parse(payload).title)).toEqual([title, title]);
    expect(pwa.alerts.size).toBe(2);
    expect(pwa.windows).toHaveLength(0);

    const order = reverse ? [...computers].reverse() : computers;
    for (const computer of order) {
      if (closeBetweenClicks) pwa.windows.length = 0;
      const alert = pwa.alerts.get(`${computer.id}:${computer.threadId}`)!;
      expect(alert.title).toBe(`${computer.name} · ${title}`);
      expect(alert.options.data).toEqual({ computerId: computer.id, threadId: computer.threadId });
      // Restart the worker before clicking: routing must survive lost memory.
      await pwa.worker(computer.id, computer.name).click(alert);
      expect(alert.close).toHaveBeenCalledOnce();
      expect(pwa.windows).toHaveLength(1);
      const hash = new URL(pwa.windows[0].url).hash;
      expect(routeComputer(hash)).toBe(computer.id);
      expect(parseRoute(hash)).toEqual({ name: "thread", id: computer.threadId });
    }
    expect(pwa.alerts.size).toBe(0);
    expect(pwa.clients.matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    expect(pwa.clients.openWindow).toHaveBeenCalledTimes(closeBetweenClicks ? 2 : 1);
    expect(pwa.windows[0].navigate).toHaveBeenCalledTimes(closeBetweenClicks ? 0 : 1);
    expect(pwa.windows[0].focus).toHaveBeenCalledTimes(closeBetweenClicks ? 0 : 1);
  });
});
