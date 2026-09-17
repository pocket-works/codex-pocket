import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pocketHome } from "./paths.js";

// Optional TLS block in ~/.codex-pocket/config.json. When present, `serve`
// keeps a Let's Encrypt wildcard certificate and a DNS A record for the
// hostname so phones get a real https:// URL that survives IP changes.
export interface TlsSettings {
  /** Cloudflare zone, e.g. example.com */
  zone: string;
  /** Name phones will open, e.g. mac.lan.example.com */
  hostname: string;
  email: string;
  cloudflareToken: string;
  /** Use Let's Encrypt staging (untrusted certs, generous rate limits). */
  staging: boolean;
}

export interface Settings {
  tls?: TlsSettings;
}

function settingsFile(): string {
  return join(pocketHome(), "config.json");
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`tls.${key} is required`);
  return v.trim();
}

export function parseTlsSettings(raw: unknown): TlsSettings {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const zone = requireString(obj, "zone").toLowerCase();
  const hostname = requireString(obj, "hostname").toLowerCase();
  if (!hostname.endsWith(`.${zone}`)) throw new Error(`tls.hostname must be inside the zone ${zone}`);
  return {
    zone,
    hostname,
    email: requireString(obj, "email"),
    cloudflareToken: requireString(obj, "cloudflareToken"),
    staging: obj.staging === true,
  };
}

export function readSettings(): Settings {
  const file = settingsFile();
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return raw.tls ? { tls: parseTlsSettings(raw.tls) } : {};
}

export function writeSettings(settings: Settings): string {
  mkdirSync(pocketHome(), { recursive: true, mode: 0o700 });
  const file = settingsFile();
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  return file;
}
