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

// How the host reaches Codex.
//   shared (default): one app-server on a local WebSocket port that the
//     desktop app is also pointed at (`link-desktop`), so phone and desktop
//     share every thread.
//   daemon: the official `codex app-server daemon` unix socket. Threads the
//     desktop app has open stay locked to it.
export interface CodexSettings {
  mode: "shared" | "daemon";
  port: number;
  binary?: string;
}

export const DEFAULT_CODEX_SETTINGS: CodexSettings = { mode: "shared", port: 7355 };

export interface Settings {
  tls?: TlsSettings;
  codex?: CodexSettings;
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

export function parseCodexSettings(raw: unknown): CodexSettings {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const mode = obj.mode ?? DEFAULT_CODEX_SETTINGS.mode;
  if (mode !== "shared" && mode !== "daemon") throw new Error(`codex.mode must be "shared" or "daemon"`);
  const port = obj.port ?? DEFAULT_CODEX_SETTINGS.port;
  if (!Number.isInteger(port) || (port as number) <= 0 || (port as number) > 65535) throw new Error("codex.port must be a valid port");
  const binary = typeof obj.binary === "string" && obj.binary.trim() ? obj.binary.trim() : undefined;
  return { mode, port: port as number, ...(binary ? { binary } : {}) };
}

export function readSettings(): Settings {
  const file = settingsFile();
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return {
    ...(raw.tls ? { tls: parseTlsSettings(raw.tls) } : {}),
    ...(raw.codex ? { codex: parseCodexSettings(raw.codex) } : {}),
  };
}

export function codexSettings(settings: Settings = readSettings()): CodexSettings {
  return settings.codex ?? DEFAULT_CODEX_SETTINGS;
}

export function writeSettings(settings: Settings): string {
  mkdirSync(pocketHome(), { recursive: true, mode: 0o700 });
  const file = settingsFile();
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  return file;
}
