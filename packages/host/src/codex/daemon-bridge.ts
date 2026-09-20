import { connect, createServer, type Server, type Socket } from "node:net";

// The ChatGPT desktop app can be pointed at a ws://host:port app-server
// (`link-desktop`), but the official daemon only listens on a unix socket.
// That socket already speaks WebSocket, so the desktop just needs its bytes
// relayed: one upstream connection per TCP client, no protocol awareness.
// Because every client dials the socket afresh, a daemon restart (for
// example a self-update) needs nothing from the bridge.

export function bridgeUrl(port: number): string {
  return `ws://127.0.0.1:${port}/`;
}

export interface DaemonBridgeOptions {
  port: number;
  socketPath: string;
  host?: string;
  log?: (msg: string) => void;
}

export interface DaemonBridge {
  port: number;
  close(): Promise<void>;
}

export function startDaemonBridge(opts: DaemonBridgeOptions): Promise<DaemonBridge> {
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? (() => {});
  const clients = new Set<Socket>();

  const server: Server = createServer((client) => {
    clients.add(client);
    const upstream = connect(opts.socketPath);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      clients.delete(client);
    };
    upstream.on("error", (err) => {
      log(`bridge: daemon socket ${opts.socketPath}: ${err.message}`);
      drop();
    });
    client.on("error", drop);
    upstream.on("close", drop);
    client.on("close", drop);
    client.pipe(upstream).pipe(client);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            for (const c of clients) c.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
