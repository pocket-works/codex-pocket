import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { DeviceStore } from "../src/auth/device-store.js";
import { CodexClient } from "../src/codex/codex-client.js";
import { CodexProxy } from "../src/proxy/codex-proxy.js";
import { createLanServer, WS_PROTOCOL, type LanServer } from "../src/server/lan-server.js";
import { startFakeAppServer, type FakeAppServer } from "./helpers.js";

const ADMIN = "admin-secret";

describe("LanServer", () => {
  let fake: FakeAppServer;
  let proxy: CodexProxy;
  let server: LanServer;
  let base: string;
  let store: DeviceStore;
  let uploadsDir: string;

  beforeEach(async () => {
    fake = await startFakeAppServer();
    fake.wss.on("connection", (sock) => {
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.method === "initialize") {
          sock.send(JSON.stringify({ id: msg.id, result: { userAgent: "f", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }));
        } else if (msg.id !== undefined && msg.method) {
          sock.send(JSON.stringify({ id: msg.id, result: { echo: msg.method } }));
        }
      });
    });
    proxy = new CodexProxy({ connect: () => CodexClient.connect({ socketPath: fake.socketPath }), backoffMs: [10] });
    const home = mkdtempSync(join(tmpdir(), "cp-ls-"));
    store = new DeviceStore(join(home, "devices.json"));
    uploadsDir = join(home, "uploads");
    server = createLanServer({
      port: 0,
      host: "127.0.0.1",
      deviceStore: store,
      proxy,
      uploadsDir,
      adminToken: ADMIN,
      pairingUrl: (code) => `http://example.test/#pair=${code}`,
    });
    const addr = await server.listen();
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await server.close();
    proxy.stop();
    await fake.close();
  });

  async function adminPairingCode(): Promise<{ code: string; url: string }> {
    const res = await fetch(`${base}/api/admin/pairing-code`, { method: "POST", headers: { Authorization: `Bearer ${ADMIN}` } });
    expect(res.status).toBe(200);
    return (await res.json()) as { code: string; url: string };
  }

  async function pair(name = "iPhone"): Promise<string> {
    const { code } = await adminPairingCode();
    const res = await fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ code, deviceName: name }) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  function openWs(protocols: string[]): Promise<{ ws: WebSocket; status: number }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, protocols);
      ws.once("open", () => resolve({ ws, status: 101 }));
      ws.once("unexpected-response", (_req, res) => resolve({ ws, status: res.statusCode ?? 0 }));
      ws.once("error", (err) => {
        // `unexpected-response` fires first for HTTP rejections; a bare error means transport failure.
        if (ws.readyState === ws.CLOSED) return;
        reject(err);
      });
    });
  }

  it("admin endpoints require the admin token", async () => {
    const res = await fetch(`${base}/api/admin/pairing-code`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("pairs a phone and lets it read /api/me", async () => {
    const token = await pair("Pixel");
    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ device: { name: "Pixel" } });
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it("rejects bad pairing codes", async () => {
    const res = await fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ code: "nope", deviceName: "x" }) });
    expect(res.status).toBe(403);
  });

  it("refuses /ws without a valid device token", async () => {
    expect((await openWs([WS_PROTOCOL])).status).toBe(401);
    expect((await openWs([WS_PROTOCOL, "tok.bogus"])).status).toBe(401);
  });

  it("proxies JSON-RPC over an authenticated /ws", async () => {
    const token = await pair();
    const { ws, status } = await openWs([WS_PROTOCOL, `tok.${token}`]);
    expect(status).toBe(101);
    expect(ws.protocol).toBe(WS_PROTOCOL);
    const reply = new Promise<unknown>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id === 1) resolve(msg);
      });
    });
    ws.send(JSON.stringify({ id: 1, method: "thread/list", params: {} }));
    expect(await reply).toMatchObject({ id: 1, result: { echo: "thread/list" } });
    ws.close();
  });

  it("lists and revokes devices through admin endpoints", async () => {
    const token = await pair("Old phone");
    const list = await (await fetch(`${base}/api/admin/devices`, { headers: { Authorization: `Bearer ${ADMIN}` } })).json() as { devices: { id: string }[] };
    expect(list.devices).toHaveLength(1);
    const del = await fetch(`${base}/api/admin/devices/${list.devices[0].id}`, { method: "DELETE", headers: { Authorization: `Bearer ${ADMIN}` } });
    expect(del.status).toBe(200);
    expect((await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  describe("uploads", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    it("stores an image for a paired phone and returns its path on the Mac", async () => {
      const token = await pair();
      const res = await fetch(`${base}/api/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
        body: png,
      });
      expect(res.status).toBe(200);
      const { path } = (await res.json()) as { path: string };
      expect(path.startsWith(uploadsDir)).toBe(true);
      expect(path.endsWith(".png")).toBe(true);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path).equals(png)).toBe(true);
    });

    it("requires a device token", async () => {
      const res = await fetch(`${base}/api/uploads`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
      expect(res.status).toBe(401);
    });

    it("rejects non-image bodies", async () => {
      const token = await pair();
      const res = await fetch(`${base}/api/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: png,
      });
      expect(res.status).toBe(415);
    });

    it("rejects bodies over the size limit", async () => {
      const token = await pair();
      const res = await fetch(`${base}/api/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
        body: Buffer.alloc(11 * 1024 * 1024),
      });
      expect(res.status).toBe(413);
    });
  });
});
