import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceStore } from "./auth/device-store.js";
import { bridgeUrl, startDaemonBridge } from "./codex/daemon-bridge.js";
import { defaultSocketPath } from "./codex/locate.js";
import { codexConnector } from "./codex/target.js";
import { LEGACY_SHARED_APP_SERVER_LABEL, uninstallUserLaunchAgent } from "./launchd.js";
import { adminToken, devicesFile, findCertFiles, uploadsDir, vapidFile, writeRuntimeInfo } from "./config/paths.js";
import { PushNotifier } from "./push/notifier.js";
import { loadOrCreateVapidKeys } from "./push/vapid.js";
import webpush from "web-push";
import { codexSettings, parsePublicUrl, readSettings } from "./config/settings.js";
import { primaryLanAddress } from "./net/lan-ip.js";
import { pairingUrl, renderQrTerminal } from "./pairing/qr.js";
import { DictationService } from "./dictation/dictation-service.js";
import { CodexProxy } from "./proxy/codex-proxy.js";
import { createLanServer } from "./server/lan-server.js";

export interface ServeOptions {
  port: number;
  /** Bind address; overrides the `bindHost` setting (default 0.0.0.0). */
  host?: string;
  /**
   * Full origin phones should use, when a reverse proxy such as
   * `tailscale serve` terminates TLS in front of us (e.g. https://mac.tailnet.ts.net).
   */
  publicUrl?: string;
  noTls?: boolean;
  staticDir?: string;
  log?: (msg: string) => void;
}

export const DEFAULT_PORT = 7333;
// VAPID wants a contact for the push services; the project page will do.
const VAPID_SUBJECT = "https://github.com/jerryan999/codex-pocket";

function defaultStaticDir(): string {
  // packages/host/dist/serve.js -> packages/web/dist
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "web", "dist");
}

export async function serve(opts: ServeOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(`[host] ${m}`));
  // PEMs dropped into certs/ are served as-is; normally TLS is terminated by
  // `tailscale serve` in front of us instead.
  const certFiles = opts.noTls ? null : findCertFiles();
  const tls = certFiles ? { key: readFileSync(certFiles.key), cert: readFileSync(certFiles.cert) } : null;
  const scheme = tls ? "https" : "http";
  const settings = readSettings();
  const lanIp = primaryLanAddress();
  const fixedUrl = opts.publicUrl ? parsePublicUrl(opts.publicUrl) : settings.publicUrl;
  if (!lanIp && !fixedUrl) throw new Error("no LAN IPv4 address found; set publicUrl (codex-pocket config set publicUrl <origin>)");

  const deviceStore = new DeviceStore(devicesFile());
  const codex = codexSettings();
  const vapid = loadOrCreateVapidKeys(vapidFile());
  const notifier = new PushNotifier({
    store: deviceStore,
    send: (subscription, payload) =>
      webpush
        .sendNotification(subscription, payload, { vapidDetails: { subject: VAPID_SUBJECT, ...vapid }, TTL: 60 * 60 })
        .then(() => undefined),
    threadTitle: async (threadId) => {
      const { thread } = await proxy.call<{ thread: { name: string | null; preview: string } }>("thread/read", { threadId });
      return (thread.name ?? thread.preview).replace(/\s+/g, " ").trim() || null;
    },
    log,
  });
  const proxy = new CodexProxy({ connect: codexConnector(), log, tap: (msg) => void notifier.handle(msg) });
  const publicUrl = fixedUrl ?? `${scheme}://${lanIp}:${opts.port}`;
  const server = createLanServer({
    port: opts.port,
    host: opts.host ?? settings.bindHost,
    tls,
    staticDir: opts.staticDir ?? defaultStaticDir(),
    uploadsDir: uploadsDir(),
    deviceStore,
    proxy,
    adminToken: adminToken(),
    pairingUrl: (code) => pairingUrl(publicUrl, code),
    push: { vapidPublicKey: vapid.publicKey, notifier },
    dictation: new DictationService({ log, proxy: settings.outboundProxy }),
    log,
  });

  const addr = await server.listen();
  // The desktop app dials ws://127.0.0.1:<port> (`link-desktop`); relay it
  // onto the daemon's unix socket. An older self-managed app-server would
  // hold that port, so its LaunchAgent is retired first.
  if (uninstallUserLaunchAgent(LEGACY_SHARED_APP_SERVER_LABEL)) log(`removed retired ${LEGACY_SHARED_APP_SERVER_LABEL} LaunchAgent`);
  const bridge = await startDaemonBridge({ port: codex.port, socketPath: defaultSocketPath(), log });
  log(`desktop bridge ${bridgeUrl(bridge.port)} -> ${defaultSocketPath()}`);
  writeRuntimeInfo({ pid: process.pid, port: addr.port, tls: !!tls, publicUrl });
  const note = tls ? "" : fixedUrl ? "  (TLS terminated by the proxy in front)" : "  (plain HTTP: no certificate in ~/.codex-pocket/certs)";
  log(`listening on ${publicUrl}${note}`);
  proxy.start().then(
    () => log("connected to Codex app-server (official daemon)"),
    (err) => log(`Codex app-server not reachable yet, will retry: ${err instanceof Error ? err.message : err}`),
  );

  const devices = await deviceStore.list();
  if (devices.length === 0) {
    const code = deviceStore.createPairingCode();
    const url = pairingUrl(publicUrl, code);
    console.log("\nNo paired devices yet. Scan to pair (valid 10 minutes):\n");
    console.log(await renderQrTerminal(url));
    console.log(`${url}\n\nOr type this code on the pairing screen: ${code.slice(0, 4)}-${code.slice(4)}\n`);
  } else {
    log(`${devices.length} paired device(s); run \`codex-pocket pair\` to add another`);
  }

  const shutdown = () => {
    log("shutting down");
    proxy.stop();
    Promise.all([server.close(), bridge.close()]).finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}
