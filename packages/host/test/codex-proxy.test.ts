import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { JsonRpcMessage } from "@codex-pocket/protocol";
import { CodexClient } from "../src/codex/codex-client.js";
import { CodexProxy, POCKET_UPSTREAM_STATUS, type Downstream } from "../src/proxy/codex-proxy.js";
import { startFakeAppServer, type FakeAppServer } from "./helpers.js";

// In-memory phone: records everything the proxy sends it.
class Phone implements Downstream {
  readonly inbox: JsonRpcMessage[] = [];
  send(msg: JsonRpcMessage): void {
    this.inbox.push(msg);
  }
  async waitFor(pred: (m: JsonRpcMessage) => boolean, timeoutMs = 1000): Promise<JsonRpcMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.inbox.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("timed out waiting for message");
  }
}

// Fake Codex that answers initialize and echoes everything else.
function installEchoUpstream(sock: WebSocket): void {
  sock.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === "initialize") {
      sock.send(JSON.stringify({ id: msg.id, result: { userAgent: "fake", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }));
    } else if (msg.method === "fail") {
      sock.send(JSON.stringify({ id: msg.id, error: { code: 42, message: "as requested" } }));
    } else if (msg.id !== undefined && msg.method) {
      sock.send(JSON.stringify({ id: msg.id, result: { echo: msg.method, params: msg.params } }));
    }
  });
}

describe("CodexProxy", () => {
  let fake: FakeAppServer;
  let proxy: CodexProxy;
  let upstreamSock: WebSocket;

  beforeEach(async () => {
    fake = await startFakeAppServer();
    fake.wss.on("connection", installEchoUpstream);
    proxy = new CodexProxy({
      connect: () => CodexClient.connect({ socketPath: fake.socketPath }),
      backoffMs: [10],
      releaseGraceMs: 30,
    });
    const pending = fake.nextConnection();
    await proxy.start();
    upstreamSock = await pending;
  });

  afterEach(async () => {
    proxy.stop();
    await fake.close();
  });

  it("forwards a phone request upstream and returns the response to that phone only", async () => {
    const a = new Phone();
    const b = new Phone();
    const ha = proxy.attach(a);
    proxy.attach(b);
    ha.receive({ id: "req-1", method: "thread/list", params: { limit: 1 } });
    const res = await a.waitFor((m) => "id" in m && m.id === "req-1");
    expect(res).toMatchObject({ id: "req-1", result: { echo: "thread/list", params: { limit: 1 } } });
    expect(b.inbox.some((m) => "id" in m && m.id === "req-1")).toBe(false);
  });

  it("relays upstream errors with their code", async () => {
    const a = new Phone();
    proxy.attach(a).receive({ id: 5, method: "fail" });
    const res = await a.waitFor((m) => "id" in m && m.id === 5);
    expect(res).toMatchObject({ id: 5, error: { code: 42, message: "as requested" } });
  });

  it("refuses initialize from a phone", async () => {
    const a = new Phone();
    proxy.attach(a).receive({ id: 9, method: "initialize", params: {} });
    const res = await a.waitFor((m) => "id" in m && m.id === 9);
    expect(res).toMatchObject({ id: 9, error: { code: -32601 } });
  });

  it("broadcasts upstream notifications to every phone", async () => {
    const a = new Phone();
    const b = new Phone();
    proxy.attach(a);
    proxy.attach(b);
    upstreamSock.send(JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "hi" } }));
    for (const p of [a, b]) {
      const n = await p.waitFor((m) => "method" in m && m.method === "item/agentMessage/delta");
      expect(n).toMatchObject({ params: { delta: "hi" } });
    }
  });

  it("sends the upstream status on attach", async () => {
    const a = new Phone();
    proxy.attach(a);
    expect(a.inbox[0]).toMatchObject({ method: POCKET_UPSTREAM_STATUS, params: { connected: true, serverInfo: { codexHome: "/h" } } });
  });

  it("broadcasts server requests, lets the first answer win, and replays pending ones to late phones", async () => {
    const a = new Phone();
    const b = new Phone();
    const ha = proxy.attach(a);
    const hb = proxy.attach(b);
    const upstreamReply = new Promise<unknown>((resolve) => {
      upstreamSock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id === "srv-1" && !msg.method) resolve(msg);
      });
    });
    upstreamSock.send(JSON.stringify({ id: "srv-1", method: "item/commandExecution/requestApproval", params: { command: "rm" } }));
    await a.waitFor((m) => "id" in m && m.id === "srv-1");
    await b.waitFor((m) => "id" in m && m.id === "srv-1");
    expect(proxy.pendingServerRequestCount).toBe(1);

    // A late phone sees the still-pending approval.
    const late = new Phone();
    proxy.attach(late);
    expect(late.inbox.some((m) => "id" in m && m.id === "srv-1")).toBe(true);

    ha.receive({ id: "srv-1", result: { decision: "accept" } });
    hb.receive({ id: "srv-1", result: { decision: "decline" } });
    expect(await upstreamReply).toMatchObject({ id: "srv-1", result: { decision: "accept" } });
    expect(proxy.pendingServerRequestCount).toBe(0);
  });

  it("drops a pending server request when Codex reports it resolved elsewhere", async () => {
    const a = new Phone();
    const ha = proxy.attach(a);
    const upstreamMessages: unknown[] = [];
    upstreamSock.on("message", (raw) => upstreamMessages.push(JSON.parse(raw.toString())));
    upstreamSock.send(JSON.stringify({ id: "srv-2", method: "item/fileChange/requestApproval", params: {} }));
    await a.waitFor((m) => "id" in m && m.id === "srv-2");
    upstreamSock.send(JSON.stringify({ method: "serverRequest/resolved", params: { threadId: "t", requestId: "srv-2" } }));
    await a.waitFor((m) => "method" in m && m.method === "serverRequest/resolved");
    expect(proxy.pendingServerRequestCount).toBe(0);
    ha.receive({ id: "srv-2", result: { decision: "accept" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(upstreamMessages.some((m) => (m as { id?: unknown }).id === "srv-2")).toBe(false);
  });

  it("releases resumed threads shortly after the last phone leaves", async () => {
    const upstreamMessages: { method?: string; params?: { threadId?: string } }[] = [];
    upstreamSock.on("message", (raw) => upstreamMessages.push(JSON.parse(raw.toString())));
    const a = new Phone();
    const ha = proxy.attach(a);
    ha.receive({ id: 1, method: "thread/resume", params: { threadId: "t-1" } });
    await a.waitFor((m) => "id" in m && m.id === 1);
    ha.receive({ id: 2, method: "thread/start", params: { cwd: "/x" } });
    await a.waitFor((m) => "id" in m && m.id === 2);
    expect(proxy.heldThreadIds).toEqual(["t-1"]);

    ha.detach();
    // A quick reconnect cancels the release.
    const hb = proxy.attach(new Phone());
    await new Promise((r) => setTimeout(r, 50));
    expect(upstreamMessages.some((m) => m.method === "thread/unsubscribe")).toBe(false);

    hb.detach();
    await new Promise((r) => setTimeout(r, 60));
    expect(upstreamMessages.filter((m) => m.method === "thread/unsubscribe").map((m) => m.params?.threadId)).toEqual(["t-1"]);
    expect(proxy.heldThreadIds).toEqual([]);
  });

  it("reports upstream loss to phones and reconnects", async () => {
    const a = new Phone();
    proxy.attach(a);
    const reconnected = fake.nextConnection();
    upstreamSock.close();
    await a.waitFor((m) => "method" in m && m.method === POCKET_UPSTREAM_STATUS && (m.params as { connected: boolean }).connected === false);
    await reconnected;
    await a.waitFor((m) => "method" in m && m.method === POCKET_UPSTREAM_STATUS && (m.params as { connected: boolean }).connected === true && m !== a.inbox[0]);
    expect(proxy.isUpstreamConnected).toBe(true);
  });
});
