#!/usr/bin/env node
import { adminRequest } from "./admin-client.js";
import type { Device } from "./auth/device-store.js";
import { CodexClient } from "./codex/codex-client.js";
import { renderQrTerminal } from "./pairing/qr.js";
import { DEFAULT_PORT, serve } from "./serve.js";

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
