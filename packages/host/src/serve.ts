import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceStore } from "./auth/device-store.js";
import { CodexClient } from "./codex/codex-client.js";
import { adminToken, devicesFile, findCertFiles, uploadsDir, writeRuntimeInfo } from "./config/paths.js";
import { primaryLanAddress } from "./net/lan-ip.js";
import { pairingUrl, renderQrTerminal } from "./pairing/qr.js";
import { CodexProxy } from "./proxy/codex-proxy.js";
import { createLanServer } from "./server/lan-server.js";

export interface ServeOptions {
  port: number;
  host?: string;
  /** Hostname phones should use; defaults to the LAN IP. Stage 5 sets this to the DNS name. */
  publicHost?: string;
  noTls?: boolean;
  staticDir?: string;
  log?: (msg: string) => void;
}

export const DEFAULT_PORT = 7333;

function defaultStaticDir(): string {
  // packages/host/dist/serve.js -> packages/web/dist
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "web", "dist");
}

export async function serve(opts: ServeOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(`[host] ${m}`));
  const certFiles = opts.noTls ? null : findCertFiles();
  const tls = certFiles ? { key: readFileSync(certFiles.key), cert: readFileSync(certFiles.cert) } : null;
  const scheme = tls ? "https" : "http";
  const publicHost = opts.publicHost ?? primaryLanAddress();
  if (!publicHost) throw new Error("no LAN IPv4 address found; pass --public-host");

  const deviceStore = new DeviceStore(devicesFile());
  const proxy = new CodexProxy({ connect: () => CodexClient.connect(), log });
  const publicUrl = `${scheme}://${publicHost}:${opts.port}`;
  const server = createLanServer({
    port: opts.port,
    host: opts.host,
    tls,
    staticDir: opts.staticDir ?? defaultStaticDir(),
    uploadsDir: uploadsDir(),
    deviceStore,
    proxy,
    adminToken: adminToken(),
    pairingUrl: (code) => pairingUrl(publicUrl, code),
    log,
  });

  const addr = await server.listen();
  writeRuntimeInfo({ pid: process.pid, port: addr.port, tls: !!tls, publicUrl });
  log(`listening on ${publicUrl}${tls ? "" : "  (plain HTTP: no certificate in ~/.codex-pocket/certs)"}`);

  proxy.start().then(
    () => log("connected to Codex app-server"),
    (err) => log(`Codex app-server not reachable yet, will retry: ${err instanceof Error ? err.message : err}`),
  );

  const devices = await deviceStore.list();
  if (devices.length === 0) {
    const url = pairingUrl(publicUrl, deviceStore.createPairingCode());
    console.log("\nNo paired devices yet. Scan to pair (valid 10 minutes):\n");
    console.log(await renderQrTerminal(url));
    console.log(url + "\n");
  } else {
    log(`${devices.length} paired device(s); run \`codex-pocket pair\` to add another`);
  }

  const shutdown = () => {
    log("shutting down");
    proxy.stop();
    server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}
