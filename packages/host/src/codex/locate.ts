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

export function codexCliRunner(codexBin = process.env.CODEX_BIN ?? "codex"): DaemonRunner {
  return async (args) => {
    const { stdout } = await execFileAsync(codexBin, args, { timeout: 30_000 });
    return stdout;
  };
}

// `codex app-server daemon start` is idempotent: it starts the shared local
// daemon if needed and always reports its socket path as JSON. The desktop
// app manages the same daemon, so whoever starts it first, both share it.
export async function ensureDaemon(run: DaemonRunner = codexCliRunner()): Promise<DaemonInfo> {
  const stdout = await run(["app-server", "daemon", "start"]);
  const line = stdout.trim().split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error(`unexpected output from codex daemon start: ${stdout.slice(0, 200)}`);
  const info = JSON.parse(line) as Partial<DaemonInfo>;
  if (typeof info.socketPath !== "string" || !info.socketPath) {
    throw new Error("codex daemon start returned no socketPath");
  }
  return info as DaemonInfo;
}
