import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { JsonRpcMessage } from "@codex-pocket/protocol";
import type { DeviceStore } from "../auth/device-store.js";
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
  deviceStore: DeviceStore;
  proxy: CodexProxy;
  /** Shared secret for the loopback-only admin endpoints. */
  adminToken: string;
  /** Builds the URL a phone should open for a given pairing code. */
  pairingUrl: (code: string) => string;
  log?: (msg: string) => void;
}

export interface LanServer {
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
  readonly tls: boolean;
}

// WebSocket subprotocols: the client offers `cp1` plus `tok.<device token>`.
// Browsers cannot set headers on WebSocket upgrades, and putting the token in
// the URL would leak it into logs, so the subprotocol carries it instead.
export const WS_PROTOCOL = "cp1";
const WS_TOKEN_PREFIX = "tok.";

const MAX_BODY_BYTES = 16 * 1024;

export function createLanServer(opts: LanServerOptions): LanServer {
  const log = opts.log ?? (() => {});
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    handleHttp(opts, req, res).catch((err) => {
      log(`http error: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    });
  };
  const server: Server = opts.tls ? createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, handler) : createHttpServer(handler);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, handleProtocols: selectProtocol });

  server.on("upgrade", (req, socket, head) => {
    handleUpgrade(opts, wss, req, socket, head).catch((err) => {
      log(`upgrade error: ${err instanceof Error ? err.message : err}`);
      socket.destroy();
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage & { deviceName?: string }) => {
    const handle = opts.proxy.attach({
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    });
    log(`phone connected: ${req.deviceName ?? "?"}`);
    ws.on("message", (raw) => {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(raw.toString()) as JsonRpcMessage;
      } catch {
        return;
      }
      handle.receive(msg);
    });
    ws.on("close", () => {
      handle.detach();
      log(`phone disconnected: ${req.deviceName ?? "?"}`);
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
  (req as IncomingMessage & { deviceName?: string }).deviceName = device.name;
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
    return sendJson(res, 200, { device, upstream: opts.proxy.isUpstreamConnected });
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

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? (JSON.parse(text) as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}
