import { connect, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { bridgeUrl, startDaemonBridge, type DaemonBridge } from "../src/codex/daemon-bridge.js";
import { tmpSocketPath } from "./helpers.js";

// Stand-in for the daemon's unix listener: echoes with a prefix so a test can
// tell the bytes made a round trip through the bridge.
const upstreamSockets: Socket[] = [];

function startEchoUnixServer(socketPath: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((sock) => {
      upstreamSockets.push(sock);
      sock.on("data", (d) => sock.write(`echo:${d}`));
    });
    server.listen(socketPath, () => resolve(server));
  });
}

function dial(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: "127.0.0.1", port }, () => resolve(sock));
    sock.once("error", reject);
  });
}

function nextData(sock: Socket): Promise<string> {
  return new Promise((resolve) => sock.once("data", (d) => resolve(d.toString())));
}

function closed(sock: Socket): Promise<void> {
  return new Promise((resolve) => sock.once("close", () => resolve()));
}

describe("startDaemonBridge", () => {
  const cleanup: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!();
  });

  async function bridgeTo(socketPath: string): Promise<DaemonBridge> {
    const bridge = await startDaemonBridge({ port: 0, socketPath });
    cleanup.push(() => bridge.close());
    return bridge;
  }

  it("relays bytes both ways between a TCP client and the unix socket", async () => {
    const socketPath = tmpSocketPath();
    const upstream = await startEchoUnixServer(socketPath);
    cleanup.push(() => new Promise((r) => upstream.close(() => r())));
    const bridge = await bridgeTo(socketPath);

    const client = await dial(bridge.port);
    client.write("hello");
    expect(await nextData(client)).toBe("echo:hello");
    client.destroy();
  });

  it("closes the TCP side when the upstream goes away", async () => {
    const socketPath = tmpSocketPath();
    const upstream = await startEchoUnixServer(socketPath);
    const bridge = await bridgeTo(socketPath);

    const client = await dial(bridge.port);
    client.write("ping");
    await nextData(client);
    upstream.close();
    for (const sock of upstreamSockets) sock.destroy();
    await closed(client);
  });

  it("refuses the TCP client when the unix socket does not exist", async () => {
    const bridge = await bridgeTo(tmpSocketPath());
    const client = await dial(bridge.port);
    await closed(client);
  });

  it("stops accepting connections once closed", async () => {
    const socketPath = tmpSocketPath();
    const upstream = await startEchoUnixServer(socketPath);
    cleanup.push(() => new Promise((r) => upstream.close(() => r())));
    const bridge = await startDaemonBridge({ port: 0, socketPath });
    await bridge.close();
    await expect(dial(bridge.port)).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("bridgeUrl", () => {
  it("is what link-desktop hands the ChatGPT app", () => {
    expect(bridgeUrl(7355)).toBe("ws://127.0.0.1:7355/");
  });
});
