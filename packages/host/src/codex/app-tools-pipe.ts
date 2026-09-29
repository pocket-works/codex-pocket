import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pocketHome } from "../config/paths.js";

// The ChatGPT desktop app lends Codex its "app tools" (create_thread,
// handoff_thread, automation_update, ...) through the bundled codex_app MCP
// server, which dials a unix socket the app opens at every launch
// (/tmp/codex-browser-use/<uuid>.sock). The app passes that path in
// CODEX_APP_TOOLS_PIPE_PATH to the app-server it spawns, and the plugin's MCP
// config forwards the variable from the app-server's environment. Linked to
// the daemon, the desktop spawns nothing, so the daemon is started with a
// fixed path instead and the desktop bridge keeps a symlink there pointed at
// the running app's socket.
//
// The socket admits a peer only when it, its parent and its grandparent are
// all signed by OpenAI (a relay from the host would be refused). Under the
// desktop app that is node <- codex <- ChatGPT. The daemon hangs off launchd,
// so the MCP's node gets one more OpenAI-signed node as its parent: the
// launcher runs whatever CODEX_MCP_NODE_PATH names (forwarded like the pipe
// path, used by nothing else), and that is a shim which starts the server as
// a child of the desktop app's bundled node: node <- node <- codex.

export const APP_TOOLS_PIPE_ENV = "CODEX_APP_TOOLS_PIPE_PATH";
export const APP_TOOLS_NODE_ENV = "CODEX_MCP_NODE_PATH";

export function appToolsLinkPath(dir = pocketHome()): string {
  return join(dir, "app-tools.sock");
}

const CHATGPT_APPS = ["/Applications/ChatGPT.app", join(homedir(), "Applications", "ChatGPT.app")];

export function appToolsNodePath(apps = CHATGPT_APPS): string | null {
  for (const app of apps) {
    const node = join(app, "Contents", "Resources", "cua_node", "bin", "node");
    if (existsSync(node)) return node;
  }
  return null;
}

// Runs its arguments (./server.mjs) under `node` as a child, forwarding
// stdio, signals and the exit status.
export function nodeShim(node: string): string {
  const js =
    'const{spawn}=require("node:child_process");' +
    'const c=spawn(process.execPath,process.argv.slice(1),{stdio:"inherit"});' +
    'for(const s of["SIGTERM","SIGINT","SIGHUP"])process.on(s,()=>c.kill(s));' +
    'c.on("exit",(code,sig)=>process.exit(code??(sig?1:0)))';
  return `#!/bin/sh
# Written by Codex Pocket: runs the ChatGPT app tools MCP one process below
# the app's own node, as its pipe requires (see app-tools-pipe.ts).
exec '${node}' -e '${js}' "$@"
`;
}

// What the daemon needs in its environment to run the desktop app's tools;
// writes the node shim next to the link.
export function appToolsDaemonEnv(apps?: string[], dir = pocketHome()): Record<string, string> {
  const env: Record<string, string> = { [APP_TOOLS_PIPE_ENV]: appToolsLinkPath(dir) };
  const node = appToolsNodePath(apps);
  if (!node) return env;
  const shim = join(dir, "app-tools-node");
  const text = nodeShim(node);
  let current: string | null = null;
  try {
    current = readFileSync(shim, "utf8");
  } catch {
    // Not written yet.
  }
  if (current !== text) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(shim, text, { mode: 0o755 });
  }
  return { ...env, [APP_TOOLS_NODE_ENV]: shim };
}

export function desktopLogsDir(): string {
  return join(homedir(), "Library", "Logs", "com.openai.codex");
}

// codex-desktop-<session uuid>-<pid>-t0-i1-<hhmmss>-<n>.log; t0 is the main
// process, the one that opens the pipe.
const MAIN_LOG = /^codex-desktop-[0-9a-f-]{36}-(\d+)-t0-.*\.log$/;
const LISTENING = /dynamic_app_tools_listening pipePath=(\S+)/g;
// The line is written during startup, before the app-server connection.
const HEAD_BYTES = 256 * 1024;
// Logs sit in YYYY/MM/DD (UTC) folders by launch date; an app left running
// longer than this is not found.
const LOOKBACK_DAYS = 14;

export function mainLogPid(fileName: string): number | null {
  const m = MAIN_LOG.exec(fileName);
  return m ? Number(m[1]) : null;
}

export function pipePathFromLog(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(LISTENING)) last = m[1];
  return last;
}

function dayDirs(root: string, now: Date, days: number): string[] {
  const dirs: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const p = (n: number) => String(n).padStart(2, "0");
    dirs.push(join(root, String(d.getUTCFullYear()), p(d.getUTCMonth() + 1), p(d.getUTCDate())));
  }
  return dirs;
}

function readHead(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface LocateOptions {
  logsDir?: string;
  now?: () => Date;
  isAlive?: (pid: number) => boolean;
  /** Whether the pipe still exists; defaults to a filesystem check. */
  exists?: (path: string) => boolean;
}

// Finds the app-tools socket of the running desktop app from its main-process
// log, or null when no running app has logged one. With several instances the
// most recently started wins.
export function createPipeLocator(opts: LocateOptions = {}): () => string | null {
  const logsDir = opts.logsDir ?? desktopLogsDir();
  const now = opts.now ?? (() => new Date());
  const alive = opts.isAlive ?? isAlive;
  const exists = opts.exists ?? existsSync;
  // A main log names its pipe once, near the top; remember it per file.
  const seen = new Map<string, string | null>();
  return () => {
    let best: { pipe: string; mtimeMs: number } | null = null;
    for (const dir of dayDirs(logsDir, now(), LOOKBACK_DAYS)) {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const pid = mainLogPid(name);
        if (pid == null || !alive(pid)) continue;
        const file = join(dir, name);
        let pipe = seen.get(file);
        let mtimeMs: number;
        try {
          mtimeMs = statSync(file).mtimeMs;
          // Not there yet may just mean not written yet: look again next time.
          if (!pipe) {
            pipe = pipePathFromLog(readHead(file));
            seen.set(file, pipe);
          }
        } catch {
          continue;
        }
        if (pipe && exists(pipe) && (!best || mtimeMs > best.mtimeMs)) best = { pipe, mtimeMs };
      }
    }
    return best?.pipe ?? null;
  };
}

function currentTarget(link: string): string | null {
  try {
    return readlinkSync(link);
  } catch {
    return null;
  }
}

// Points `link` at `target`, replacing any previous link atomically so a
// connecting MCP server never sees it missing.
export function pointLink(link: string, target: string): void {
  mkdirSync(dirname(link), { recursive: true, mode: 0o700 });
  const tmp = `${link}.${process.pid}.tmp`;
  symlinkSync(target, tmp);
  renameSync(tmp, link);
}

export interface AppToolsLinkOptions {
  link?: string;
  locate?: () => string | null;
  log?: (msg: string) => void;
  intervalMs?: number;
}

// Keeps the link on the running desktop app's pipe. A link left behind by a
// quit app is harmless (the MCP fails to start, as it would without one) and
// is repointed when the app comes back.
export function watchAppToolsPipe(opts: AppToolsLinkOptions = {}): { refresh: () => void; stop: () => void } {
  const link = opts.link ?? appToolsLinkPath();
  const locate = opts.locate ?? createPipeLocator();
  const log = opts.log ?? (() => {});
  const refresh = () => {
    try {
      const target = locate();
      if (target && target !== currentTarget(link)) {
        pointLink(link, target);
        log(`desktop app tools ${link} -> ${target}`);
      }
    } catch (err) {
      log(`desktop app tools link failed: ${err instanceof Error ? err.message : err}`);
    }
  };
  refresh();
  // The app opens the pipe ~8s before its first MCP server starts.
  const timer = setInterval(refresh, opts.intervalMs ?? 2000);
  timer.unref();
  return { refresh, stop: () => clearInterval(timer) };
}
