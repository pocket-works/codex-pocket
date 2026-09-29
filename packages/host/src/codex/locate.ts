import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { appToolsDaemonEnv } from "./app-tools-pipe.js";

const execFileAsync = promisify(execFile);

export interface DaemonInfo {
  status: "running" | "alreadyRunning" | "started" | string;
  socketPath: string;
  appServerVersion?: string;
  cliVersion?: string;
}

function codexHomeDir(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

// Where the Codex desktop app's managed app-server listens.
export function defaultSocketPath(codexHome = codexHomeDir()): string {
  return join(codexHome, "app-server-control", "app-server-control.sock");
}

export interface DaemonRunner {
  (args: string[]): Promise<string>;
}

// The daemon inherits the environment of whoever starts it, and the host may
// be a launchd job with almost none. Run codex through an interactive login
// shell, exactly as the desktop app does over SSH, so the daemon sees what
// the user's rc files export (PATH, proxies, provider API keys).
export function loginShellCommand(codexBin: string, args: string[], shell = process.env.SHELL || "/bin/zsh"): { file: string; args: string[] } {
  return { file: shell, args: ["-lic", 'exec "$0" "$@"', codexBin, ...args] };
}

// Environment the host adds for the daemon: what the ChatGPT desktop app's
// tools need (see app-tools-pipe.ts). Only a fresh daemon picks it up.
export function daemonEnv(): Record<string, string> {
  return appToolsDaemonEnv();
}

export function bundledCodexBin(apps = ["/Applications/ChatGPT.app", join(homedir(), "Applications", "ChatGPT.app")]): string | null {
  for (const app of apps) {
    const bin = join(app, "Contents", "Resources", "codex-cli", "bin", "codex");
    if (existsSync(bin)) return bin;
  }
  return null;
}

export function codexCliRunner(codexBin = process.env.CODEX_BIN ?? bundledCodexBin() ?? "codex", shell?: string): DaemonRunner {
  return async (args) => {
    const cmd = loginShellCommand(codexBin, args, shell);
    const { stdout } = await execFileAsync(cmd.file, cmd.args, { timeout: 30_000, env: { ...process.env, ...daemonEnv() } });
    return stdout;
  };
}

// `codex app-server daemon start` is idempotent: it starts the local daemon
// if needed and always reports its socket path as JSON. Codex owns the
// process from then on (pid file, self-update); the desktop app reaches it
// through the independent desktop bridge.
export async function ensureDaemon(run: DaemonRunner = codexCliRunner()): Promise<DaemonInfo> {
  const stdout = await run(["app-server", "daemon", "start"]);
  const line = stdout
    .split("\n")
    .map((l) => l.slice(Math.max(0, l.indexOf("{"))))
    .find((l) => l.startsWith("{"));
  if (!line) throw new Error(`unexpected output from codex daemon start: ${stdout.slice(0, 200)}`);
  const info = JSON.parse(line) as Partial<DaemonInfo>;
  if (typeof info.socketPath !== "string" || !info.socketPath) {
    throw new Error("codex daemon start returned no socketPath");
  }
  return info as DaemonInfo;
}

// Stops the daemon and starts a fresh one, so it picks up daemonEnv().
// Interrupts whatever the daemon is running. `daemon stop` leaves the
// updater running, and the updater respawns the app-server with its own
// environment after every self-update, so it goes too; `daemon start`
// brings up a new one.
export async function restartDaemon(
  run: DaemonRunner = codexCliRunner(),
  stopUpdater: () => Promise<void> = stopDaemonUpdater,
): Promise<DaemonInfo> {
  await stopUpdater();
  await run(["app-server", "daemon", "stop"]);
  return ensureDaemon(run);
}

export async function stopDaemonUpdater(pidFile = daemonPidFiles()[1]): Promise<void> {
  let pid: number;
  try {
    pid = (JSON.parse(readFileSync(pidFile, "utf8")) as { pid: number }).pid;
    // The pid file outlives the process; do not signal whatever reused it.
    if (!processEnvLine(pid).includes("pid-update-loop")) return;
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  for (let i = 0; i < 30; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the Codex daemon updater (pid ${pid}) did not exit`);
}

// The daemon's processes: the app-server, and the updater that respawns it
// (with its own environment) after a self-update.
export function daemonPidFiles(codexHome = codexHomeDir()): string[] {
  const dir = join(codexHome, "app-server-daemon");
  return [join(dir, "app-server.pid"), join(dir, "app-server-updater.pid")];
}

function processEnvLine(pid: number): string {
  // `ps eww` appends the environment to the command line; same user only.
  return execFileSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8" });
}

// Which of `env` the running daemon lacks (or has with another value). Empty
// when every daemon process carries all of it; null when no daemon runs.
export function daemonEnvMissing(
  env: Record<string, string> = daemonEnv(),
  opts: { pidFiles?: string[]; readEnv?: (pid: number) => string } = {},
): string[] | null {
  const readEnv = opts.readEnv ?? processEnvLine;
  const missing = new Set<string>();
  let found = false;
  for (const file of opts.pidFiles ?? daemonPidFiles()) {
    let line: string;
    try {
      const { pid } = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown };
      if (typeof pid !== "number") continue;
      line = readEnv(pid);
    } catch {
      continue;
    }
    if (!line.trim()) continue;
    found = true;
    for (const [k, v] of Object.entries(env)) if (!` ${line.trim()} `.includes(` ${k}=${v} `)) missing.add(k);
  }
  return found ? [...missing] : null;
}
