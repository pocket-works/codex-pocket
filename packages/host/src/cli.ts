#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { adminRequest } from "./admin-client.js";
import type { Device } from "./auth/device-store.js";
import { CodexClient } from "./codex/codex-client.js";
import { readSettings, setSetting, unsetSetting, writeSettings } from "./config/settings.js";
import { bridgeUrl } from "./codex/daemon-bridge.js";
import { clearDesktopEnv, currentDesktopEnv, DESKTOP_ENV_VAR, desktopBridgeAgentMatches, installDesktopBridge, readDesktopBridgeAgent, removeDesktopBridge, restoreDesktopBridge, restoreSharedAppServer, retireDesktopEnvAgent, retireSharedAppServer, setDesktopEnv, unlinkDesktop } from "./launchd.js";
import { desktopBridgeIsReady, runDesktopBridge, waitForDesktopBridge } from "./codex/desktop-bridge-service.js";
import { desktopCompat } from "./codex/desktop-compat.js";
import { appToolsLinkPath, createPipeLocator } from "./codex/app-tools-pipe.js";
import { daemonEnvMissing, restartDaemon } from "./codex/locate.js";
import { codexConnector } from "./codex/target.js";
import { codexSettings } from "./config/settings.js";
import { renderQrTerminal } from "./pairing/qr.js";
import { DEFAULT_PORT, serve } from "./serve.js";

const USAGE = `Usage: codex-pocket <command> [options]

Commands:
  serve             Serve the PWA on the LAN and proxy to the official Codex daemon
    --port <n>        Port to listen on (default ${DEFAULT_PORT})
    --host <addr>     Address to bind (default: bindHost setting, else 0.0.0.0)
    --public-url <u>  Origin for the pairing URL (default: publicUrl setting, else http://<LAN IP>:<port>)
    --no-tls          Serve plain HTTP even if certificates exist
    --static <dir>    Directory with the built web app
  config            Show ~/.codex-pocket/config.json
  config set <key> <value>    publicUrl: origin phones use when a proxy such as
                              \`tailscale serve\` fronts the host (https://computer.tailnet.ts.net)
                              bindHost:  address serve binds; 127.0.0.1 keeps it off the LAN
                              outboundProxy: HTTP proxy for the dictation stream to chatgpt.com
                              (http://127.0.0.1:1082); off by default, HTTPS_PROXY is not read
  config unset <key>
  pair              Print a QR code to pair a new phone (needs a running serve)
  devices           List paired phones
  revoke <id>       Remove a paired phone
  threads           List recent threads from the official Codex daemon
  info              Show app-server connection details
  link-desktop      Make the ChatGPT desktop app share the Codex daemon (restart ChatGPT after)
    --force           Link even if the daemon's codex lacks what the desktop app needs
  unlink-desktop    Revert the desktop app to its private app-server (restart ChatGPT after)
  desktop           Show whether the desktop app is linked and whether the daemon is ready for it
`;

interface Flags {
  positional: string[];
  values: Map<string, string | true>;
}

function parseFlags(argv: string[]): Flags {
  const positional: string[] = [];
  const values = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && key !== "no-tls") {
      values.set(key, next);
      i++;
    } else {
      values.set(key, true);
    }
  }
  return { positional, values };
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags.values.get(key);
  return typeof v === "string" ? v : undefined;
}

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const command = flags.positional[0];
  if (!command || flags.values.has("help")) {
    process.stdout.write(USAGE);
    return flags.values.has("help") ? 0 : 1;
  }
  if (process.platform !== "darwin" && ["link-desktop", "unlink-desktop", "desktop", "desktop-bridge"].includes(command)) {
    throw new Error(`${command} requires the ChatGPT desktop app on macOS. Linux supports the headless Codex host.`);
  }
  switch (command) {
    case "serve": {
      const port = Number(str(flags, "port") ?? DEFAULT_PORT);
      if (!Number.isInteger(port) || port <= 0) throw new Error("invalid --port");
      await serve({
        port,
        host: str(flags, "host"),
        publicUrl: str(flags, "public-url"),
        noTls: flags.values.has("no-tls"),
        staticDir: str(flags, "static"),
      });
      return 0;
    }
    case "desktop-bridge": {
      const port = Number(str(flags, "port"));
      if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("invalid --port");
      await runDesktopBridge(port, (message) => console.log(`[desktop-bridge] ${message}`));
      return 0;
    }
    case "config": {
      const settings = readSettings();
      const [, action, key, value] = flags.positional;
      if (action === "set") {
        if (!key || value === undefined) throw new Error("usage: codex-pocket config set <key> <value>");
        const file = writeSettings(setSetting(settings, key, value));
        console.log(`${key} saved to ${file} (restart serve to apply)`);
      } else if (action === "unset") {
        if (!key) throw new Error("usage: codex-pocket config unset <key>");
        writeSettings(unsetSetting(settings, key));
        console.log(`${key} removed (restart serve to apply)`);
      } else if (action === undefined) {
        console.log(JSON.stringify(settings, null, 2));
      } else throw new Error("usage: codex-pocket config [set <key> <value> | unset <key>]");
      return 0;
    }
    case "pair": {
      const { code, url } = await adminRequest<{ code: string; url: string }>("POST", "/api/admin/pairing-code");
      console.log("\nScan to pair (valid 10 minutes):\n");
      console.log(await renderQrTerminal(url));
      console.log(`${url}\n\nOr type this code on the pairing screen (e.g. in the installed app): ${formatCode(code)}\n`);
      return 0;
    }
    case "devices": {
      const { devices } = await adminRequest<{ devices: Device[] }>("GET", "/api/admin/devices");
      if (devices.length === 0) console.log("No paired devices.");
      for (const d of devices) {
        console.log(`${d.id}  ${d.name}  paired ${fmt(d.createdAt)}  last seen ${fmt(d.lastSeenAt)}`);
      }
      return 0;
    }
    case "revoke": {
      const id = flags.positional[1];
      if (!id) throw new Error("usage: codex-pocket revoke <id>");
      await adminRequest("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`);
      console.log(`revoked ${id}`);
      return 0;
    }
    case "link-desktop": {
      // The desktop app breaks quietly (sign-in, dictation) against a daemon
      // whose account/read lacks workspaceRouting, so look before linking.
      if (!flags.values.has("force")) {
        const compat = await probeDesktopCompat();
        if (!compat.ok) {
          console.error(`not linking: ${compat.reason}\nPass --force to link anyway.`);
          return 1;
        }
      }
      const port = codexSettings().port;
      const url = bridgeUrl(port);
      // A daemon started without the desktop app's tools environment needs
      // one restart before the desktop app moves onto it.
      if (daemonEnvMissing()?.length) {
        console.log("Restarting the Codex daemon so it can reach the desktop app's tools (running turns are interrupted)...");
        await restartDaemon();
      }
      const previousEnv = currentDesktopEnv();
      let installed = false;
      let legacyPlist: string | null = null;
      let previousBridgePlist: string | null = null;
      try {
        const args = [process.env.SHELL || "/bin/zsh", "-lic", 'exec env ELECTRON_RUN_AS_NODE=1 "$@"', "pocket-runtime", process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), "desktop-bridge", "--port", String(port)];
        const env = Object.fromEntries(["CODEX_POCKET_HOME", "CODEX_HOME", "CODEX_BIN"].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
        if (!desktopBridgeIsReady(port) || !desktopBridgeAgentMatches(args, env)) {
          legacyPlist = retireSharedAppServer();
          if (legacyPlist) console.log("Removed the retired shared app-server service.");
          previousBridgePlist = readDesktopBridgeAgent();
          installDesktopBridge(args, env);
          installed = true;
          await waitForDesktopBridge(port);
        }
        const bridgeClient = await CodexClient.connect({ url });
        bridgeClient.close();
        retireDesktopEnvAgent();
      } catch (err) {
        if (installed || legacyPlist) {
          const oldSharedPlist = legacyPlist;
          const oldBridgePlist = previousBridgePlist;
          const rollback = [
            ...(installed ? [() => removeDesktopBridge()] : []),
            ...(installed && oldBridgePlist ? [() => restoreDesktopBridge(oldBridgePlist)] : []),
            ...(oldSharedPlist ? [() => restoreSharedAppServer(oldSharedPlist)] : []),
            () => previousEnv ? setDesktopEnv(previousEnv) : clearDesktopEnv(),
          ];
          for (const restore of rollback) {
            try {
              restore();
            } catch (rollbackError) {
              console.error(`desktop link rollback failed: ${rollbackError instanceof Error ? rollbackError.message : rollbackError}`);
            }
          }
        }
        throw err;
      }
      console.log(`${DESKTOP_ENV_VAR}=${url} (desktop bridge runs independently of Codex Pocket)`);
      console.log("Quit and reopen the ChatGPT app for it to take effect.");
      return 0;
    }
    case "unlink-desktop":
      unlinkDesktop();
      console.log(`${DESKTOP_ENV_VAR} cleared. Quit and reopen the ChatGPT app for it to take effect.`);
      return 0;
    case "desktop": {
      const current = currentDesktopEnv();
      const expected = bridgeUrl(codexSettings().port);
      const same = current?.replace(/\/$/, "") === expected.replace(/\/$/, "");
      console.log(current ? `${DESKTOP_ENV_VAR}=${current}${same ? "" : `  (bridge expects ${expected})`}` : "desktop app not linked");
      console.log(`desktop bridge: ${desktopBridgeIsReady(codexSettings().port) ? "running" : "not running"}`);
      // The same probe link-desktop runs, so this answers "can I link yet?"
      // after a codex update without trying.
      const compat = await probeDesktopCompat();
      if (compat.ok) console.log(current ? "daemon: ready for the desktop app" : "daemon: ready for the desktop app (run `codex-pocket link-desktop`)");
      else console.log(`daemon: not ready, ${compat.reason}`);
      console.log(appToolsStatus());
      return 0;
    }
    case "info":
      return withClient(async (client) => {
        console.log(`url:        ${client.url}`);
        console.log(`userAgent:  ${client.serverInfo.userAgent}`);
        console.log(`codexHome:  ${client.serverInfo.codexHome}`);
      });
    case "threads":
      return withClient(async (client) => {
        const res = await client.call("thread/list", { limit: 20, sortKey: "recency_at" });
        for (const t of res.data) {
          const title = (t.name ?? t.preview ?? "").replace(/\s+/g, " ").slice(0, 60);
          console.log(`${fmt((t.recencyAt ?? t.updatedAt) * 1000)}  ${t.id}  ${t.cwd}\n    ${title}`);
        }
      });
    default:
      process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
      return 1;
  }
}

function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString("sv-SE").slice(0, 16);
}

// Whether a linked desktop app's tools (create_thread, automations, ...) can
// work: the daemon knows the fixed pipe path, and it leads to a running app.
function appToolsStatus(): string {
  const missing = daemonEnvMissing();
  if (missing == null) return "app tools: daemon not running";
  if (missing.length) return "app tools: the daemon predates this host; run `codex-pocket link-desktop` to restart it";
  const pipe = createPipeLocator()();
  return pipe ? `app tools: ${appToolsLinkPath()} -> ${pipe}` : "app tools: no running ChatGPT app has opened its tools pipe";
}

// Asks the daemon what link-desktop needs to know: signed in, and account/read
// carrying workspaceRouting.
async function probeDesktopCompat() {
  const client = await codexConnector()();
  try {
    const account = await client.rawRequest("account/read", { refreshToken: false });
    // userAgent looks like "codex-pocket/0.155.1 (Mac OS ...)"; the version is the daemon's.
    return desktopCompat(account, client.serverInfo.userAgent.split(" ")[0]?.split("/")[1]);
  } finally {
    client.close();
  }
}

async function withClient(fn: (client: CodexClient) => Promise<void>): Promise<number> {
  const client = await codexConnector()();
  try {
    await fn(client);
    return 0;
  } finally {
    client.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
