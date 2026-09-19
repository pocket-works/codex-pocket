import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexClient } from "../src/codex/codex-client.js";
import { startFakeAppServer, type FakeAppServer } from "./helpers.js";

describe("CodexClient.connect", () => {
  let fake: FakeAppServer;

  beforeEach(async () => {
    fake = await startFakeAppServer();
  });

  afterEach(async () => {
    await fake.close();
  });

  it("locates the socket via the daemon runner and performs the initialize handshake", async () => {
    const received: unknown[] = [];
    fake.wss.on("connection", (sock) => {
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        if (msg.method === "initialize") {
          sock.send(JSON.stringify({ id: msg.id, result: { userAgent: "fake", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }));
        }
      });
    });
    const client = await CodexClient.connect({
      daemonRunner: async () => JSON.stringify({ status: "running", socketPath: fake.socketPath }),
    });
    expect(client.serverInfo.codexHome).toBe("/h");
    expect(client.url).toBe(`ws+unix://${fake.socketPath}:/`);
    // Wait for the trailing `initialized` notification to arrive.
    await new Promise((r) => setTimeout(r, 20));
    expect(received.map((m) => (m as { method: string }).method)).toEqual(["initialize", "initialized"]);
    const params = (received[0] as { params: { clientInfo: { name: string }; capabilities: { experimentalApi: boolean } } }).params;
    expect(params.clientInfo.name).toBe("codex-pocket");
    // thread/queue/* and friends are gated behind this capability.
    expect(params.capabilities.experimentalApi).toBe(true);
    client.close();
  });

  it("closes the socket when initialize is rejected", async () => {
    fake.wss.on("connection", (sock) => {
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        sock.send(JSON.stringify({ id: msg.id, error: { code: 1, message: "denied" } }));
      });
    });
    await expect(CodexClient.connect({ socketPath: fake.socketPath })).rejects.toThrow("denied");
  });

  it("calls project/list with pagination and returns every project", async () => {
    const request: unknown[] = [];
    fake.wss.on("connection", (sock) => {
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.method === "initialize") {
          sock.send(JSON.stringify({ id: msg.id, result: { userAgent: "fake", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }));
          return;
        }
        if (msg.method !== "project/list") return;
        request.push(msg.params);
        const first = !msg.params?.cursor;
        sock.send(
          JSON.stringify({
            id: msg.id,
            result: first
              ? { data: [{ id: "p1", name: "one", roots: [{ path: "/p/one" }], metadata: {}, position: 0, createdAt: 0, updatedAt: 0, recencyAt: null }], nextCursor: "c1" }
              : { data: [{ id: "p2", name: "two", roots: [{ path: "/p/two" }], metadata: {}, position: 1, createdAt: 0, updatedAt: 0, recencyAt: null }], nextCursor: null },
          }),
        );
      });
    });
    const client = await CodexClient.connect({ socketPath: fake.socketPath });
    const first = await client.call("project/list", { sortKey: "position", limit: 200, cursor: null });
    expect(first.data.map((p) => p.name)).toEqual(["one"]);
    const second = await client.call("project/list", { sortKey: "position", limit: 200, cursor: first.nextCursor });
    expect(second.data.map((p) => p.name)).toEqual(["two"]);
    expect(second.nextCursor).toBeNull();
    expect(request).toEqual([
      { sortKey: "position", limit: 200, cursor: null },
      { sortKey: "position", limit: 200, cursor: "c1" },
    ]);
    client.close();
  });
});
