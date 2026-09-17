#!/usr/bin/env node
import { adminRequest } from "./admin-client.js";
import type { Device } from "./auth/device-store.js";
import { CodexClient } from "./codex/codex-client.js";
import { certsDir } from "./config/paths.js";
import { parseTlsSettings, readSettings, writeSettings } from "./config/settings.js";
import { CloudflareDns } from "./dns/cloudflare.js";
import { installLaunchAgent, uninstallLaunchAgent } from "./launchd.js";
import { renderQrTerminal } from "./pairing/qr.js";
import { DEFAULT_PORT, serve } from "./serve.js";
import { issueCertificate, wildcardFor } from "./tls/acme.js";
import { certificateExpiry, TlsManager } from "./tls/manager.js";

const USAGE = `Usage: codex-pocket <command> [options]

Commands:
  serve             Serve the PWA on the LAN and proxy to the Codex desktop app-server
    --port <n>        Port to listen on (default ${DEFAULT_PORT})
    --host <addr>     Address to bind (default 0.0.0.0)
    --public-host <h> Hostname/IP printed in the pairing URL (default: LAN IP)
    --no-tls          Serve plain HTTP even if certificates exist
    --static <dir>    Directory with the built web app
  pair              Print a QR code to pair a new phone (needs a running serve)
  devices           List paired phones
  revoke <id>       Remove a paired phone
  threads           List recent threads from the Codex desktop app-server
  info              Show app-server connection details
  tls setup         Store domain settings for automatic HTTPS (Let's Encrypt via Cloudflare DNS)
    --zone <zone> --hostname <name> --email <addr> --token <cloudflare-token> [--staging]
  tls issue         Request/renew the certificate now
  tls status        Show certificate expiry and settings
  install           Install a launchd agent so serve runs at login
  uninstall         Remove the launchd agent
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
    if (next !== undefined && !next.startsWith("--") && key !== "no-tls" && key !== "staging") {
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

async function tlsCommand(flags: Flags): Promise<number> {
  const sub = flags.positional[1];
  const log = (m: string) => console.log(`[tls] ${m}`);
  switch (sub) {
    case "setup": {
      const tls = parseTlsSettings({
        zone: str(flags, "zone"),
        hostname: str(flags, "hostname"),
        email: str(flags, "email"),
        cloudflareToken: str(flags, "token"),
        staging: flags.values.has("staging"),
      });
      const file = writeSettings({ ...readSettings(), tls });
      console.log(`saved ${file}\ncertificate will cover ${wildcardFor(tls.hostname)}; run \`codex-pocket tls issue\` or just \`serve\``);
      return 0;
    }
    case "issue": {
      const settings = readSettings().tls;
      if (!settings) throw new Error("no tls settings; run `codex-pocket tls setup` first");
      const dns = new CloudflareDns(settings.cloudflareToken);
      const manager = new TlsManager({
        settings,
        certsDir: certsDir(),
        dns,
        issue: () => issueCertificate({ settings, dns, certsDir: certsDir(), log }),
        lanIp: () => null,
        now: () => Number.MAX_SAFE_INTEGER, // force renewal
        log,
      });
      const material = await manager.ensure();
      if (!material) return 1;
      console.log(`certificate valid until ${certificateExpiry(material.cert).toISOString()}`);
      return 0;
    }
    case "status": {
      const settings = readSettings().tls;
      console.log(settings ? `hostname: ${settings.hostname} (zone ${settings.zone}, ${settings.staging ? "staging" : "production"})` : "no tls settings");
      const manager = settings
        ? new TlsManager({ settings, certsDir: certsDir(), dns: { upsertRecord: async () => false, deleteRecord: async () => false }, issue: async () => { throw new Error("n/a"); }, lanIp: () => null })
        : null;
      const material = manager?.current();
      console.log(material ? `certificate: valid until ${certificateExpiry(material.cert).toISOString()}` : `certificate: none in ${certsDir()}`);
      return 0;
    }
    default:
      process.stderr.write(`usage: codex-pocket tls <setup|issue|status>\n`);
      return 1;
  }
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
        publicHost: str(flags, "public-host"),
        noTls: flags.values.has("no-tls"),
        staticDir: str(flags, "static"),
      });
      return 0;
    }
    case "pair": {
      const { url } = await adminRequest<{ url: string }>("POST", "/api/admin/pairing-code");
      console.log("\nScan to pair (valid 10 minutes):\n");
      console.log(await renderQrTerminal(url));
      console.log(url + "\n");
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
    case "tls":
      return tlsCommand(flags);
    case "install": {
      const file = installLaunchAgent();
      console.log(`installed ${file}\nlogs: ~/.codex-pocket/host.log`);
      return 0;
    }
    case "uninstall":
      console.log(uninstallLaunchAgent() ? "launchd agent removed" : "no launchd agent installed");
      return 0;
    case "info":
      return withClient(async (client) => {
        console.log(`socket:     ${client.socketPath}`);
        console.log(`userAgent:  ${client.serverInfo.userAgent}`);
        console.log(`codexHome:  ${client.serverInfo.codexHome}`);
      });
    case "threads":
      return withClient(async (client) => {
        const res = await client.call("thread/list", { limit: 20, sortKey: "updated_at" });
        for (const t of res.data) {
          const title = (t.name ?? t.preview ?? "").replace(/\s+/g, " ").slice(0, 60);
          console.log(`${fmt(t.updatedAt * 1000)}  ${t.id}  ${t.cwd}\n    ${title}`);
        }
      });
    default:
      process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
      return 1;
  }
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString("sv-SE").slice(0, 16);
}

async function withClient(fn: (client: CodexClient) => Promise<void>): Promise<number> {
  const client = await CodexClient.connect();
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
