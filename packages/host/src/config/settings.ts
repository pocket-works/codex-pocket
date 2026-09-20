import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pocketHome } from "./paths.js";

// The host always talks to the official `codex app-server daemon` over its
// unix socket. `port` is the local TCP port the host relays onto that socket
// for the ChatGPT desktop app (`link-desktop`), so phone and desktop share
// one process and every thread.
export interface CodexSettings {
  port: number;
}

export const DEFAULT_CODEX_SETTINGS: CodexSettings = { port: 7355 };

export interface Settings {
  codex?: CodexSettings;
  /** Origin phones use when a reverse proxy (e.g. `tailscale serve`) fronts the host. */
  publicUrl?: string;
  /** Address `serve` binds; 127.0.0.1 keeps the host off the LAN when a proxy fronts it. */
  bindHost?: string;
  /**
   * HTTP proxy for connections the host makes to the internet (currently
   * just the dictation stream to chatgpt.com). Off by default: `ws` does
   * not read HTTPS_PROXY, so this is the only way to route it.
   */
  outboundProxy?: string;
}

export function parseOutboundProxy(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new Error(`outboundProxy must be an http(s) proxy URL such as http://127.0.0.1:1082, got ${JSON.stringify(raw)}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`outboundProxy must use http:// or https://, got ${v}`);
  return v;
}

export function parseBindHost(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || /\s/.test(v)) throw new Error(`bindHost must be an IP address or hostname, got ${JSON.stringify(raw)}`);
  return v;
}

// Keys `codex-pocket config set/unset` may touch; the nested codex block is
// edited by hand.
const SETTABLE: Record<"publicUrl" | "bindHost" | "outboundProxy", (raw: unknown) => string> = {
  publicUrl: parsePublicUrl,
  bindHost: parseBindHost,
  outboundProxy: parseOutboundProxy,
};

type SettableKey = keyof typeof SETTABLE;

function settableKey(key: string): SettableKey {
  if (!(key in SETTABLE)) throw new Error(`unknown setting "${key}"; known: ${Object.keys(SETTABLE).join(", ")}`);
  return key as SettableKey;
}

export function setSetting(settings: Settings, key: string, value: string): Settings {
  const k = settableKey(key);
  return { ...settings, [k]: SETTABLE[k](value) };
}

export function unsetSetting(settings: Settings, key: string): Settings {
  const k = settableKey(key);
  const { [k]: _drop, ...rest } = settings;
  return rest;
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
  // `mode` and `binary` belonged to the retired shared mode and are ignored.
  const port = obj.port ?? DEFAULT_CODEX_SETTINGS.port;
  if (!Number.isInteger(port) || (port as number) <= 0 || (port as number) > 65535) throw new Error("codex.port must be a valid port");
  return { port: port as number };
}

export function readSettings(): Settings {
  const file = settingsFile();
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return {
    ...(raw.codex ? { codex: parseCodexSettings(raw.codex) } : {}),
    ...(raw.publicUrl ? { publicUrl: parsePublicUrl(raw.publicUrl) } : {}),
    ...(raw.bindHost ? { bindHost: parseBindHost(raw.bindHost) } : {}),
    ...(raw.outboundProxy ? { outboundProxy: parseOutboundProxy(raw.outboundProxy) } : {}),
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
