import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pocketHome } from "./paths.js";

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
  codex?: CodexSettings;
  /** Origin phones use when a reverse proxy (e.g. `tailscale serve`) fronts the host. */
  publicUrl?: string;
}

export function parsePublicUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("publicUrl must be a string");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`publicUrl is not a valid URL: ${raw}`);
  }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`publicUrl must be a plain http(s) origin, got ${raw}`);
  }
  return url.origin;
}

function settingsFile(): string {
  return join(pocketHome(), "config.json");
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
    ...(raw.codex ? { codex: parseCodexSettings(raw.codex) } : {}),
    ...(raw.publicUrl ? { publicUrl: parsePublicUrl(raw.publicUrl) } : {}),
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
