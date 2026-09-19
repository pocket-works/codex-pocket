import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonRpcMessage } from "@codex-pocket/protocol";
import { DeviceStore, type PushSubscription } from "../src/auth/device-store.js";
import { pushEventFor } from "../src/push/events.js";
import { PushNotifier } from "../src/push/notifier.js";

const sub = (endpoint: string): PushSubscription => ({ endpoint, keys: { p256dh: "p", auth: "a" } });

function freshStore(): DeviceStore {
  return new DeviceStore(join(mkdtempSync(join(tmpdir(), "cp-push-")), "devices.json"));
}

async function pairedDevice(store: DeviceStore, name: string): Promise<string> {
  return (await store.redeemPairingCode(store.createPairingCode(), name))!.deviceId;
}

describe("pushEventFor", () => {
  const n = (method: string, params: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", method, params });

  it("turns a finished turn into a notification, ignoring interrupted ones", () => {
    expect(pushEventFor(n("turn/completed", { threadId: "t1", turn: { id: "u", status: "completed" } }))).toMatchObject({ threadId: "t1", body: "Codex finished" });
    expect(pushEventFor(n("turn/completed", { threadId: "t1", turn: { id: "u", status: "failed" } }))).toMatchObject({ body: "Turn failed" });
    expect(pushEventFor(n("turn/completed", { threadId: "t1", turn: { id: "u", status: "interrupted" } }))).toBeNull();
  });

  it("asks for approvals and input, and reports errors that will not be retried", () => {
    const req = (method: string, params: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id: 1, method, params });
    expect(pushEventFor(req("item/commandExecution/requestApproval", { threadId: "t1", command: "rm -rf build" }))).toMatchObject({ threadId: "t1", body: "Approve: rm -rf build" });
    expect(pushEventFor(req("item/fileChange/requestApproval", { threadId: "t1" }))).toMatchObject({ body: "Approve file changes" });
    expect(pushEventFor(req("item/tool/requestUserInput", { threadId: "t1" }))).toMatchObject({ body: "Codex has a question" });
    expect(pushEventFor(n("error", { threadId: "t1", turnId: "u", willRetry: false, error: { message: "boom" } }))).toMatchObject({ body: "boom" });
    expect(pushEventFor(n("error", { threadId: "t1", turnId: "u", willRetry: true, error: { message: "boom" } }))).toBeNull();
    expect(pushEventFor(n("item/agentMessage/delta", { threadId: "t1" }))).toBeNull();
  });
});

describe("DeviceStore push subscriptions", () => {
  it("stores one subscription per device and lists them", async () => {
    const store = freshStore();
    const a = await pairedDevice(store, "A");
    const b = await pairedDevice(store, "B");
    await store.setPushSubscription(a, sub("https://push/a"));
    await store.setPushSubscription(b, sub("https://push/b"));
    await store.setPushSubscription(b, null);
    expect(await store.listPushSubscriptions()).toEqual([{ deviceId: a, subscription: sub("https://push/a") }]);
    expect(await store.setPushSubscription("nope", sub("x"))).toBe(false);
  });
});

describe("PushNotifier", () => {
  async function setup() {
    const store = freshStore();
    const a = await pairedDevice(store, "A");
    const b = await pairedDevice(store, "B");
    await store.setPushSubscription(a, sub("https://push/a"));
    await store.setPushSubscription(b, sub("https://push/b"));
    const sent: { endpoint: string; payload: string }[] = [];
    const notifier = new PushNotifier({
      store,
      send: async (s, payload) => {
        if (s.endpoint.endsWith("/dead")) throw Object.assign(new Error("gone"), { statusCode: 410 });
        sent.push({ endpoint: s.endpoint, payload });
      },
      threadTitle: async (id) => (id === "t1" ? "Fix login" : null),
    });
    return { store, a, b, sent, notifier };
  }

  it("pushes to every subscribed device except those watching the thread", async () => {
    const { a, sent, notifier } = await setup();
    notifier.setClientState("conn1", a, { threadId: "t1", visible: true });
    await notifier.handle({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "t1", turn: { id: "u", status: "completed" } } });
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push/b"]);
    expect(JSON.parse(sent[0].payload)).toEqual({ title: "Fix login", body: "Codex finished", threadId: "t1", tag: "t1" });
  });

  it("pushes again once the watching client goes to the background or disconnects", async () => {
    const { a, sent, notifier } = await setup();
    notifier.setClientState("conn1", a, { threadId: "t1", visible: false });
    await notifier.handle({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "t1", turn: { id: "u", status: "completed" } } });
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push/a", "https://push/b"]);
    notifier.setClientState("conn1", a, { threadId: "t1", visible: true });
    notifier.clearClient("conn1");
    await notifier.handle({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "t1", turn: { id: "u", status: "completed" } } });
    expect(sent.length).toBe(4);
  });

  it("drops subscriptions the push service reports as gone", async () => {
    const { store, a, notifier } = await setup();
    await store.setPushSubscription(a, sub("https://push/dead"));
    await notifier.handle({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "t9", turn: { id: "u", status: "completed" } } });
    expect((await store.listPushSubscriptions()).map((s) => s.deviceId)).not.toContain(a);
  });
});
