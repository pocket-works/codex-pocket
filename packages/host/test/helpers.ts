import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

export function tmpSocketPath(): string {
  // macOS caps unix socket paths at 104 bytes, so keep the name short.
  return join(mkdtempSync(join(tmpdir(), "cp-")), "s.sock");
}

export interface FakeAppServer {
  socketPath: string;
  wss: WebSocketServer;
  /** Resolves with the server side of the next accepted connection. */
  nextConnection(): Promise<WebSocket>;
  close(): Promise<void>;
}

// Minimal stand-in for `codex app-server --listen unix://`: a WebSocket
// server bound to a unix socket. Tests attach their own message handlers.
export async function startFakeAppServer(): Promise<FakeAppServer> {
  const socketPath = tmpSocketPath();
  const server: Server = createServer();
  const wss = new WebSocketServer({ server });
  const waiting: Array<(ws: WebSocket) => void> = [];
  const accepted: WebSocket[] = [];
  wss.on("connection", (ws) => {
    const w = waiting.shift();
    if (w) w(ws); else accepted.push(ws);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    wss,
    nextConnection() {
      const ready = accepted.shift();
      if (ready) return Promise.resolve(ready);
      return new Promise((resolve) => waiting.push(resolve));
    },
    close() {
      return new Promise((resolve) => wss.close(() => server.close(() => resolve())));
    },
  };
}
