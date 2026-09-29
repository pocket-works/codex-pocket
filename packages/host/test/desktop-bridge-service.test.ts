import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexClient } from "../src/codex/codex-client.js";
import { startDesktopBridge } from "../src/codex/desktop-bridge-service.js";
import { startFakeAppServer, type FakeAppServer } from "./helpers.js";

describe("startDesktopBridge", () => {
  let fake: FakeAppServer;
  let bridge: { close(): Promise<void> } | null;
  let readyPath: string;

  beforeEach(async () => {
    fake = await startFakeAppServer();
    bridge = null;
    readyPath = join(mkdtempSync(join(tmpdir(), "pocket-bridge-")), "ready.json");
  });

  afterEach(async () => {
    await bridge?.close();
    await fake.close();
  });

  it("publishes the desktop URL only after the upstream handshake succeeds", async () => {
    let answerHandshake!: () => void;
    let holdFirstHandshake = true;
    const handshake = new Promise<void>((resolve) => {
      fake.wss.on("connection", (sock) => sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { id?: number; method?: string };
        if (msg.method !== "initialize") return;
        const answer = () => sock.send(JSON.stringify({ id: msg.id, result: { userAgent: "fake", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }));
        if (holdFirstHandshake) {
          answerHandshake = answer;
          resolve();
        } else answer();
      }));
    });
    const urls: string[] = [];
    let watcherStopped = false;
    const starting = startDesktopBridge({
      port: 0,
      socketPath: fake.socketPath,
      readyPath,
      setEnv: (url) => urls.push(url),
      watchAppTools: () => ({ stop: () => { watcherStopped = true; } }),
    });
    await handshake;
    expect(urls).toEqual([]);
    expect(existsSync(readyPath)).toBe(false);
    holdFirstHandshake = false;
    answerHandshake();
    bridge = await starting;
    const ready = JSON.parse(readFileSync(readyPath, "utf8")) as { pid: number; port: number };
    expect(ready.pid).toBe(process.pid);
    expect(urls).toEqual([`ws://127.0.0.1:${ready.port}/`]);
    const client = await CodexClient.connect({ url: urls[0] });
    client.close();
    await bridge.close();
    bridge = null;
    expect(watcherStopped).toBe(true);
    expect(existsSync(readyPath)).toBe(false);
  });

  it("does not publish a URL if the daemon rejects the handshake", async () => {
    fake.wss.on("connection", (sock) => sock.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: number; method?: string };
      if (msg.method === "initialize") sock.send(JSON.stringify({ id: msg.id, error: { code: 1, message: "denied" } }));
    }));
    const urls: string[] = [];
    let watcherStopped = false;
    await expect(startDesktopBridge({
      port: 0,
      socketPath: fake.socketPath,
      readyPath,
      setEnv: (url) => urls.push(url),
      watchAppTools: () => ({ stop: () => { watcherStopped = true; } }),
    })).rejects.toThrow("denied");
    expect(urls).toEqual([]);
    expect(watcherStopped).toBe(true);
    expect(existsSync(readyPath)).toBe(false);
  });

  it("removes the readiness marker if setting the desktop environment fails", async () => {
    fake.wss.on("connection", (sock) => sock.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: number; method?: string };
      if (msg.method === "initialize") sock.send(JSON.stringify({ id: msg.id, result: { userAgent: "fake", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }));
    }));
    await expect(startDesktopBridge({
      port: 0,
      socketPath: fake.socketPath,
      readyPath,
      setEnv: () => { throw new Error("launchctl failed"); },
      watchAppTools: () => ({ stop: () => {} }),
    })).rejects.toThrow("launchctl failed");
    expect(existsSync(readyPath)).toBe(false);
  });
});
