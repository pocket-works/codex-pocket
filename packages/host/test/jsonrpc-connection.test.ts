import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket as ServerSocket } from "ws";
import { JsonRpcConnection, JsonRpcRemoteError } from "../src/codex/jsonrpc-connection.js";
import { openUnixWebSocket } from "../src/codex/unix-websocket.js";
import { startFakeAppServer, type FakeAppServer } from "./helpers.js";

describe("JsonRpcConnection", () => {
  let fake: FakeAppServer;
  let serverSide: ServerSocket;

  beforeEach(async () => {
    fake = await startFakeAppServer();
  });

  afterEach(async () => {
    await fake.close();
  });

  async function connect(): Promise<JsonRpcConnection> {
    const pending = fake.nextConnection();
    const ws = await openUnixWebSocket(fake.socketPath);
    serverSide = await pending;
    return new JsonRpcConnection(ws);
  }
  it("correlates a response with its request id", async () => {
    const conn = await connect();
    serverSide.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === "echo") serverSide.send(JSON.stringify({ id: msg.id, result: { got: msg.params } }));
    });
    const result = await conn.request("echo", { hello: "world" });
    expect(result).toEqual({ got: { hello: "world" } });
    conn.close();
  });

  it("rejects with JsonRpcRemoteError when the server returns an error", async () => {
    const conn = await connect();
    serverSide.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      serverSide.send(JSON.stringify({ id: msg.id, error: { code: -32601, message: "nope" } }));
    });
    await expect(conn.request("missing", {})).rejects.toBeInstanceOf(JsonRpcRemoteError);
    conn.close();
  });

  it("dispatches server notifications to listeners", async () => {
    const conn = await connect();
    const seen = new Promise<unknown>((resolve) => {
      conn.onNotification((n) => resolve(n));
    });
    serverSide.send(JSON.stringify({ method: "thing/changed", params: { x: 1 }, emittedAtMs: 5 }));
    expect(await seen).toEqual({ method: "thing/changed", params: { x: 1 }, emittedAtMs: 5 });
    conn.close();
  });

  it("answers server-initiated requests through the registered handler", async () => {
    const conn = await connect();
    conn.onServerRequest(async (req) => {
      if (req.method === "approve?") return { decision: "yes", echo: req.params };
      throw new Error("unhandled");
    });
    const reply = new Promise<unknown>((resolve) => {
      serverSide.on("message", (raw) => resolve(JSON.parse(raw.toString())));
    });
    serverSide.send(JSON.stringify({ id: "srv-1", method: "approve?", params: { cmd: "ls" } }));
    expect(await reply).toEqual({ jsonrpc: "2.0", id: "srv-1", result: { decision: "yes", echo: { cmd: "ls" } } });
    conn.close();
  });

  it("returns a JSON-RPC error when the server-request handler throws", async () => {
    const conn = await connect();
    conn.onServerRequest(async () => { throw new Error("boom"); });
    const reply = new Promise<{ error: { message: string } }>((resolve) => {
      serverSide.on("message", (raw) => resolve(JSON.parse(raw.toString())));
    });
    serverSide.send(JSON.stringify({ id: 7, method: "x", params: {} }));
    expect((await reply).error.message).toBe("boom");
    conn.close();
  });

  it("rejects all pending requests when the socket closes", async () => {
    const conn = await connect();
    const pending = conn.request("never-answered", {});
    serverSide.close();
    await expect(pending).rejects.toThrow(/closed/);
  });
});
