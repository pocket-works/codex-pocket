import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { JsonRpcMessage } from "@codex-pocket/protocol";
import type { Device, DeviceStore, PushSubscription } from "../auth/device-store.js";
import type { PushNotifier } from "../push/notifier.js";
import type { DictationService } from "../dictation/dictation-service.js";
import type { CodexProxy } from "../proxy/codex-proxy.js";
import { serveStatic } from "./static-files.js";

export interface TlsMaterial {
  key: Buffer | string;
  cert: Buffer | string;
}

export interface LanServerOptions {
  port: number;
  host?: string;
  tls?: TlsMaterial | null;
  staticDir?: string | null;
  /** Where phone image attachments are written so Codex can read them as `localImage`. */
  uploadsDir?: string | null;
  deviceStore: DeviceStore;
  proxy: CodexProxy;
  /** Shared secret for the loopback-only admin endpoints. */
  adminToken: string;
  /** Origin phones use to reach us; reported to the admin status endpoint. */
  publicUrl?: string;
  /** Builds the URL a phone should open for a given pairing code. */
  pairingUrl: (code: string) => string;
  /** Web Push: public key handed to phones, and where their subscriptions/state go. Absent = push disabled. */
  push?: { vapidPublicKey: string; notifier: PushNotifier } | null;
  /** Streaming dictation relay (`pocket/dictation/*`). Absent = dictation disabled. */
  dictation?: DictationService | null;
  log?: (msg: string) => void;
}

/** Phones tell the host what they are looking at, so push can stay quiet for it. */
export const CLIENT_STATE_METHOD = "pocket/client/state";

export interface LanServer {
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
  /** Swap the certificate without dropping the listener (renewals). No-op on plain HTTP. */
  setTls(material: TlsMaterial): void;
  readonly tls: boolean;
}

// WebSocket subprotocols: the client offers `cp1` plus `tok.<device token>`.
// Browsers cannot set headers on WebSocket upgrades, and putting the token in
// the URL would leak it into logs, so the subprotocol carries it instead.
export const WS_PROTOCOL = "cp1";
const WS_TOKEN_PREFIX = "tok.";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

export function createLanServer(opts: LanServerOptions): LanServer {
  const log = opts.log ?? (() => {});
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    handleHttp(opts, req, res).catch((err) => {
      log(`http error: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    });
  };
  const httpsServer = opts.tls ? createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, handler) : null;
  const server: Server = httpsServer ?? createHttpServer(handler);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, handleProtocols: selectProtocol });

  server.on("upgrade", (req, socket, head) => {
    handleUpgrade(opts, wss, req, socket, head).catch((err) => {
      log(`upgrade error: ${err instanceof Error ? err.message : err}`);
      socket.destroy();
    });
  });

  let nextConnId = 1;
  wss.on("connection", (ws: WebSocket, req: IncomingMessage & { device?: Device }) => {
    const connId = String(nextConnId++);
    const device = req.device;
    const send = (msg: JsonRpcMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const handle = opts.proxy.attach({ send });
    const dictation = opts.dictation?.attach(send) ?? null;
    log(`phone connected: ${device?.name ?? "?"}`);
    ws.on("message", (raw) => {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(raw.toString()) as JsonRpcMessage;
      } catch {
        return;
      }
      // Host-level messages never go upstream.
      if ("method" in msg && msg.method === CLIENT_STATE_METHOD) {
        const p = (msg.params ?? {}) as { threadId?: unknown; visible?: unknown };
        if (device && opts.push) opts.push.notifier.setClientState(connId, device.id, { threadId: typeof p.threadId === "string" ? p.threadId : null, visible: p.visible === true });
        return;
      }
      if (dictation?.handle(msg)) return;
      handle.receive(msg);
    });
    ws.on("close", () => {
      handle.detach();
      dictation?.detach();
      opts.push?.notifier.clearClient(connId);
      log(`phone disconnected: ${device?.name ?? "?"}`);
    });
  });

  return {
    tls: !!opts.tls,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(opts.port, opts.host ?? "0.0.0.0", () => {
          server.off("error", reject);
          resolve(server.address() as AddressInfo);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => server.close(() => resolve()));
      });
    },
    setTls(material) {
      httpsServer?.setSecureContext({ key: material.key, cert: material.cert });
    },
  };
}

function selectProtocol(protocols: Set<string>): string | false {
  return protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false;
}

async function handleUpgrade(
  opts: LanServerOptions,
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
  const offered = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
  const tokenEntry = offered.find((p) => p.startsWith(WS_TOKEN_PREFIX));
  const device = tokenEntry ? await opts.deviceStore.verifyToken(tokenEntry.slice(WS_TOKEN_PREFIX.length)) : null;
  if (!device || !offered.includes(WS_PROTOCOL)) return rejectUpgrade(socket, 401, "Unauthorized");
  (req as IncomingMessage & { device?: Device }).device = device;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function handleHttp(opts: LanServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (path === "/api/health" && method === "GET") {
    return sendJson(res, 200, { ok: true, upstream: opts.proxy.isUpstreamConnected });
  }

  if (path === "/api/pair" && method === "POST") {
    const body = await readJsonBody(req);
    const code = typeof body?.code === "string" ? body.code : "";
    const deviceName = typeof body?.deviceName === "string" ? body.deviceName : "";
    const paired = await opts.deviceStore.redeemPairingCode(code, deviceName);
    if (!paired) return sendJson(res, 403, { error: "invalid or expired pairing code" });
    return sendJson(res, 200, paired);
  }

  if (path === "/api/me" && method === "GET") {
    const device = await opts.deviceStore.verifyToken(bearerToken(req));
    if (!device) return sendJson(res, 401, { error: "unauthorized" });
    // `host` names the Mac on the new-thread screen, as the official app does;
    // `home` is where project-less chats get their scratch folder.
    return sendJson(res, 200, { device, upstream: opts.proxy.isUpstreamConnected, host: hostname(), home: homedir(), dictation: opts.dictation?.available ?? false });
  }

  if (path === "/api/uploads" && method === "POST") {
    const device = await opts.deviceStore.verifyToken(bearerToken(req));
    if (!device) return sendJson(res, 401, { error: "unauthorized" });
    if (!opts.uploadsDir) return sendJson(res, 404, { error: "uploads disabled" });
    const ext = IMAGE_EXT[(req.headers["content-type"] ?? "").split(";")[0].trim()];
    if (!ext) return sendJson(res, 415, { error: "only image uploads are accepted" });
    let body: Buffer;
    try {
      body = await readRawBody(req, MAX_UPLOAD_BYTES);
    } catch (err) {
      return sendJson(res, err instanceof BodyTooLarge ? 413 : 400, { error: describe(err) });
    }
    mkdirSync(opts.uploadsDir, { recursive: true, mode: 0o700 });
    const file = join(opts.uploadsDir, `${randomBytes(8).toString("hex")}.${ext}`);
    writeFileSync(file, body, { mode: 0o600 });
    return sendJson(res, 200, { path: file });
  }

  if (path === "/api/push/vapid" && method === "GET") {
    const device = await opts.deviceStore.verifyToken(bearerToken(req));
    if (!device) return sendJson(res, 401, { error: "unauthorized" });
    if (!opts.push) return sendJson(res, 404, { error: "push disabled" });
    return sendJson(res, 200, { publicKey: opts.push.vapidPublicKey });
  }

  if (path === "/api/push/subscription" && (method === "PUT" || method === "DELETE")) {
    const device = await opts.deviceStore.verifyToken(bearerToken(req));
    if (!device) return sendJson(res, 401, { error: "unauthorized" });
    if (!opts.push) return sendJson(res, 404, { error: "push disabled" });
    if (method === "DELETE") {
      await opts.deviceStore.setPushSubscription(device.id, null);
      return sendJson(res, 200, { ok: true });
    }
    const body = await readJsonBody(req);
    const sub = parsePushSubscription(body);
    if (!sub) return sendJson(res, 400, { error: "invalid subscription" });
    await opts.deviceStore.setPushSubscription(device.id, sub);
    return sendJson(res, 200, { ok: true });
  }

  if (path.startsWith("/api/admin/")) {
    if (!isLoopback(req) || !constantTimeEqual(bearerToken(req), opts.adminToken)) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    if (path === "/api/admin/pairing-code" && method === "POST") {
      const code = opts.deviceStore.createPairingCode();
      return sendJson(res, 200, { code, url: opts.pairingUrl(code) });
    }
    if (path === "/api/admin/devices" && method === "GET") {
      return sendJson(res, 200, { devices: await opts.deviceStore.list() });
    }
    if (path === "/api/admin/status" && method === "GET") {
      return sendJson(res, 200, {
        publicUrl: opts.publicUrl ?? null,
        codexConnected: opts.proxy.isUpstreamConnected,
        deviceCount: (await opts.deviceStore.list()).length,
      });
    }
    const revoke = path.match(/^\/api\/admin\/devices\/([^/]+)$/);
    if (revoke && method === "DELETE") {
      const ok = await opts.deviceStore.revoke(revoke[1]);
      return sendJson(res, ok ? 200 : 404, { ok });
    }
    return sendJson(res, 404, { error: "not found" });
  }

  if (path.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });

  if (opts.staticDir && serveStatic(opts.staticDir, req, res)) return;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>codex-pocket</title><p>codex-pocket host is running, but the web app is not built yet.</p>");
}

function bearerToken(req: IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function parsePushSubscription(raw: unknown): PushSubscription | null {
  const o = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; expirationTime?: unknown } | null;
  if (!o || typeof o.endpoint !== "string" || !/^https:\/\//.test(o.endpoint)) return null;
  if (typeof o.keys?.p256dh !== "string" || typeof o.keys?.auth !== "string") return null;
  return { endpoint: o.endpoint, keys: { p256dh: o.keys.p256dh, auth: o.keys.auth }, expirationTime: typeof o.expirationTime === "number" ? o.expirationTime : null };
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

class BodyTooLarge extends Error {
  constructor() {
    super("body too large");
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) {
      reject(new BodyTooLarge());
      req.resume();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const text = (await readRawBody(req, MAX_BODY_BYTES)).toString("utf8");
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
