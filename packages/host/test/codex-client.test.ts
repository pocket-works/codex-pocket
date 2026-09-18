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
    expect((received[0] as { params: { clientInfo: { name: string } } }).params.clientInfo.name).toBe("codex-pocket");
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
});
