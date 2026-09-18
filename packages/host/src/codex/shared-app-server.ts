import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

// The ChatGPT desktop app ships its own codex binary and normally spawns a
// private `app-server` over stdio. Codex allows only one writer per thread
// across processes, so a phone connected to a different process cannot touch
// a thread the desktop has open. The fix: run ONE app-server that listens on
// a local WebSocket port, point the desktop at it (CODEX_APP_SERVER_WS_URL,
// see `link-desktop`), and connect the host to the same process. Inside one
// process every connection may subscribe to every thread.
//
// The process is started detached so a host restart does not drop the
// desktop's session; `ensure` adopts an already-running listener.

export const DESKTOP_CODEX_BINARY = "/Applications/ChatGPT.app/Contents/Resources/codex";
export const DEFAULT_SHARED_PORT = 7355;

// Mirrors what the desktop app passes to its private app-server, so features
// (code-mode host, bundled app plugin) behave identically.
export const SHARED_APP_SERVER_ARGS = [
  "-c",
  "features.code_mode_host=true",
  "app-server",
  "--analytics-default-enabled",
  "-c",
  "plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true",
];

export interface SharedAppServerOptions {
  port: number;
  /** Codex binary; defaults to the desktop app's bundled one, then `codex` on PATH. */
  binary?: string;
  logFile: string;
  /** Overridable for tests. */
  probe?: (url: string) => Promise<boolean>;
  spawnProcess?: (binary: string, args: string[]) => void;
  readyTimeoutMs?: number;
  log?: (msg: string) => void;
}

export function sharedAppServerUrl(port: number): string {
  return `ws://127.0.0.1:${port}/`;
}

export function resolveCodexBinary(explicit?: string): string {
  if (explicit) return explicit;
  if (existsSync(DESKTOP_CODEX_BINARY)) return DESKTOP_CODEX_BINARY;
  return process.env.CODEX_BIN ?? "codex";
}

async function httpReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function spawnDetached(binary: string, args: string[], logFile: string): void {
  mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
  const out = openSync(logFile, "a");
  const child = spawn(binary, args, {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, LOG_FORMAT: "json", RUST_LOG: process.env.RUST_LOG ?? "warn" },
  });
  child.unref();
}

// Returns the WebSocket URL once the listener answers /readyz.
export async function ensureSharedAppServer(opts: SharedAppServerOptions): Promise<string> {
  const log = opts.log ?? (() => {});
  const probe = opts.probe ?? httpReady;
  const readyUrl = `http://127.0.0.1:${opts.port}/readyz`;
  if (await probe(readyUrl)) return sharedAppServerUrl(opts.port);

  const binary = resolveCodexBinary(opts.binary);
  const args = [...SHARED_APP_SERVER_ARGS, "--listen", `ws://127.0.0.1:${opts.port}`];
  log(`starting shared app-server: ${binary} (port ${opts.port})`);
  (opts.spawnProcess ?? ((b, a) => spawnDetached(b, a, opts.logFile)))(binary, args);

  const deadline = Date.now() + (opts.readyTimeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (await probe(readyUrl)) return sharedAppServerUrl(opts.port);
  }
  throw new Error(`shared app-server did not become ready on port ${opts.port}; see ${opts.logFile}`);
}
