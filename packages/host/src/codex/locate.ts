import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DaemonInfo {
  status: "running" | "alreadyRunning" | "started" | string;
  socketPath: string;
  appServerVersion?: string;
  cliVersion?: string;
}

// Where the Codex desktop app's managed app-server listens.
export function defaultSocketPath(codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex")): string {
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

export function codexCliRunner(codexBin = process.env.CODEX_BIN ?? "codex", shell?: string): DaemonRunner {
  return async (args) => {
    const cmd = loginShellCommand(codexBin, args, shell);
    const { stdout } = await execFileAsync(cmd.file, cmd.args, { timeout: 30_000 });
    return stdout;
  };
}

// `codex app-server daemon start` is idempotent: it starts the local daemon
// if needed and always reports its socket path as JSON. Codex owns the
// process from then on (pid file, self-update); the desktop app reaches it
// through the host's TCP bridge.
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
