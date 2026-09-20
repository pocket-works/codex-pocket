#!/usr/bin/env node
import { adminRequest } from "./admin-client.js";
import type { Device } from "./auth/device-store.js";
import { CodexClient } from "./codex/codex-client.js";
import { readSettings, setSetting, unsetSetting, writeSettings } from "./config/settings.js";
import { bridgeUrl } from "./codex/daemon-bridge.js";
import { currentDesktopEnv, DESKTOP_ENV_VAR, installLaunchAgent, LEGACY_SHARED_APP_SERVER_LABEL, linkDesktop, uninstallLaunchAgent, uninstallUserLaunchAgent, unlinkDesktop } from "./launchd.js";
import { desktopCompat } from "./codex/desktop-compat.js";
import { codexConnector } from "./codex/target.js";
import { codexSettings } from "./config/settings.js";
import { renderQrTerminal } from "./pairing/qr.js";
import { DEFAULT_PORT, serve } from "./serve.js";

const USAGE = `Usage: codex-pocket <command> [options]

Commands:
  serve             Serve the PWA on the LAN and proxy to the Codex desktop app-server
    --port <n>        Port to listen on (default ${DEFAULT_PORT})
    --host <addr>     Address to bind (default: bindHost setting, else 0.0.0.0)
    --public-url <u>  Origin for the pairing URL (default: publicUrl setting, else http://<LAN IP>:<port>)
    --no-tls          Serve plain HTTP even if certificates exist
    --static <dir>    Directory with the built web app
  config            Show ~/.codex-pocket/config.json
  config set <key> <value>    publicUrl: origin phones use when a proxy such as
                              \`tailscale serve\` fronts the host (https://mac.tailnet.ts.net)
                              bindHost:  address serve binds; 127.0.0.1 keeps it off the LAN
                              outboundProxy: HTTP proxy for the dictation stream to chatgpt.com
                              (http://127.0.0.1:1082); off by default, HTTPS_PROXY is not read
  config unset <key>
  pair              Print a QR code to pair a new phone (needs a running serve)
  devices           List paired phones
  revoke <id>       Remove a paired phone
  threads           List recent threads from the Codex desktop app-server
  info              Show app-server connection details
  install           Install the host LaunchAgent so serve runs at login
  uninstall         Remove the host LaunchAgent
  link-desktop      Make the ChatGPT desktop app share the host's Codex daemon (restart ChatGPT after)
    --force           Link even if the daemon's codex lacks what the desktop app needs
  unlink-desktop    Revert the desktop app to its private app-server (restart ChatGPT after)
  desktop           Show whether the desktop app is linked
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
    return command ? 0 : 1;
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
    case "install": {
      const file = installLaunchAgent();
      console.log(`installed ${file}\nlogs: ~/.codex-pocket/host.log`);
      return 0;
    }
    case "uninstall": {
      const removedHost = uninstallLaunchAgent();
      const removedLegacy = uninstallUserLaunchAgent(LEGACY_SHARED_APP_SERVER_LABEL);
      console.log(removedHost || removedLegacy ? "launchd agents removed" : "no launchd agents installed");
      return 0;
    }
    case "link-desktop": {
      // The desktop app breaks quietly (sign-in, dictation) against a daemon
      // whose account/read lacks workspaceRouting, so look before linking.
      if (!flags.values.has("force")) {
        const client = await codexConnector()();
        let compat;
        try {
          const account = await client.rawRequest("account/read", { refreshToken: false });
          // userAgent looks like "codex-pocket/0.155.1 (Mac OS ...)"; the version is the daemon's.
          compat = desktopCompat(account, client.serverInfo.userAgent.split(" ")[0]?.split("/")[1]);
        } finally {
          client.close();
        }
        if (!compat.ok) {
          console.error(`not linking: ${compat.reason}\nPass --force to link anyway.`);
          return 1;
        }
      }
      const url = bridgeUrl(codexSettings().port);
      const file = linkDesktop(url);
      console.log(`${DESKTOP_ENV_VAR}=${url} (persisted in ${file})
Quit and reopen the ChatGPT app for it to take effect.`);
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
      console.log(current ? `${DESKTOP_ENV_VAR}=${current}${same ? "" : `  (host expects ${expected})`}` : "desktop app not linked (run `codex-pocket link-desktop`)");
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
