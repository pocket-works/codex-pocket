import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexCliRunner,
  bundledCodexBin,
  daemonEnv,
  daemonEnvMissing,
  defaultSocketPath,
  ensureDaemon,
  loginShellCommand,
  restartDaemon,
  stopDaemonUpdater,
} from "../src/codex/locate.js";

describe("defaultSocketPath", () => {
  it("points at the app-server control socket under CODEX_HOME", () => {
    expect(defaultSocketPath("/x/.codex")).toBe("/x/.codex/app-server-control/app-server-control.sock");
  });
});

describe("ensureDaemon", () => {
  it("parses the socket path from `codex app-server daemon start`", async () => {
    const info = await ensureDaemon(async (args) => {
      expect(args).toEqual(["app-server", "daemon", "start"]);
      return '{"status":"alreadyRunning","socketPath":"/tmp/a.sock","appServerVersion":"0.154.0"}\n';
    });
    expect(info.socketPath).toBe("/tmp/a.sock");
    expect(info.status).toBe("alreadyRunning");
  });

  it("ignores non-JSON noise before the JSON line", async () => {
    const info = await ensureDaemon(async () => 'warning: something\n{"status":"started","socketPath":"/tmp/b.sock"}\n');
    expect(info.socketPath).toBe("/tmp/b.sock");
  });

  it("tolerates terminal escape prefixes an interactive shell prints before the JSON", async () => {
    const info = await ensureDaemon(async () => '\x1b]1337;ShellIntegrationVersion=14;shell=zsh\x07{"status":"running","socketPath":"/tmp/c.sock"}\n');
    expect(info.socketPath).toBe("/tmp/c.sock");
  });

  it("fails loudly when no socket path is reported", async () => {
    await expect(ensureDaemon(async () => '{"status":"weird"}')).rejects.toThrow(/socketPath/);
    await expect(ensureDaemon(async () => "not json")).rejects.toThrow(/unexpected output/);
  });
});

describe("loginShellCommand", () => {
  it("runs codex through an interactive login shell like the desktop app does over SSH", () => {
    expect(loginShellCommand("codex", ["app-server", "daemon", "start"], "/bin/zsh")).toEqual({
      file: "/bin/zsh",
      args: ["-lic", 'exec "$0" "$@"', "codex", "app-server", "daemon", "start"],
    });
  });

  it("rejects shells whose argument syntax is incompatible", () => {
    expect(() => loginShellCommand("codex", [], "/usr/bin/fish")).toThrow(/login shell/);
  });

  it("passes shell metacharacters as literal arguments", async () => {
    const run = codexCliRunner("/bin/echo", "/bin/bash");
    expect((await run(["$(false)", "a b", "; exit 1"])).trim()).toBe("$(false) a b ; exit 1");
  });

  it("passes arguments through untouched", async () => {
    const run = codexCliRunner("/bin/echo", "/bin/sh");
    expect((await run(["app-server", "daemon", "start"])).trim()).toBe("app-server daemon start");
  });
});

describe("bundledCodexBin", () => {
  it("finds the CLI shipped with ChatGPT when no separate Codex install is needed", () => {
    const app = join(mkdtempSync(join(tmpdir(), "pocket-codex-")), "ChatGPT.app");
    const bin = join(app, "Contents", "Resources", "codex-cli", "bin", "codex");
    mkdirSync(join(app, "Contents", "Resources", "codex-cli", "bin"), { recursive: true });
    writeFileSync(bin, "");
    expect(bundledCodexBin(["/missing/ChatGPT.app", app])).toBe(bin);
    expect(bundledCodexBin(["/missing/ChatGPT.app"])).toBeNull();
  });
});

describe("daemon environment", () => {
  it("starts codex with what the desktop app's tools need", async () => {
    process.env.CODEX_POCKET_HOME = mkdtempSync(join(tmpdir(), "pocket-"));
    const run = codexCliRunner("/usr/bin/env", "/bin/sh");
    const lines = (await run([])).split("\n");
    expect(Object.keys(daemonEnv("darwin"))).toContain("CODEX_APP_TOOLS_PIPE_PATH");
    expect(daemonEnv("linux")).toEqual({});
    for (const [key, value] of Object.entries(daemonEnv())) expect(lines).toContain(`${key}=${value}`);
    delete process.env.CODEX_POCKET_HOME;
  });

  it("restarts by stopping the updater and the daemon, then starting a fresh one", async () => {
    const calls: string[] = [];
    const info = await restartDaemon(
      async (args) => {
        calls.push(args.join(" "));
        return '{"status":"started","socketPath":"/tmp/d.sock"}';
      },
      async () => void calls.push("stop updater"),
    );
    expect(calls).toEqual(["stop updater", "app-server daemon stop", "app-server daemon start"]);
    expect(info.status).toBe("started");
  });

  it("leaves alone a process that reused the updater's pid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "daemon-updater-"));
    const file = join(dir, "app-server-updater.pid");
    writeFileSync(file, JSON.stringify({ pid: process.pid }));
    await stopDaemonUpdater(file);
    expect(process.kill(process.pid, 0)).toBe(true);
  });
});

describe("daemonEnvMissing", () => {
  const env = { CODEX_APP_TOOLS_PIPE_PATH: "/h/.codex-pocket/app-tools.sock" };
  const pidFiles = (...pids: number[]) => {
    const dir = mkdtempSync(join(tmpdir(), "daemon-pids-"));
    return pids.map((pid, i) => {
      const file = join(dir, `p${i}.pid`);
      writeFileSync(file, JSON.stringify({ pid, processStartTime: "x" }));
      return file;
    });
  };
  const cmd = "/x/codex app-server --listen unix:// --managed-daemon";

  it("is empty when every daemon process carries the variable", () => {
    const readEnv = () => `${cmd} HOME=/h CODEX_APP_TOOLS_PIPE_PATH=/h/.codex-pocket/app-tools.sock PATH=/bin\n`;
    expect(daemonEnvMissing(env, { pidFiles: pidFiles(1, 2), readEnv })).toEqual([]);
  });

  it("names the variable when the updater, which respawns the app-server, lacks it", () => {
    const readEnv = (pid: number) => (pid === 1 ? `${cmd} CODEX_APP_TOOLS_PIPE_PATH=/h/.codex-pocket/app-tools.sock` : `${cmd} HOME=/h`);
    expect(daemonEnvMissing(env, { pidFiles: pidFiles(1, 2), readEnv })).toEqual(["CODEX_APP_TOOLS_PIPE_PATH"]);
  });

  it("does not accept a different value or a longer path", () => {
    const readEnv = () => `${cmd} CODEX_APP_TOOLS_PIPE_PATH=/h/.codex-pocket/app-tools.sock.old`;
    expect(daemonEnvMissing(env, { pidFiles: pidFiles(1), readEnv })).toEqual(["CODEX_APP_TOOLS_PIPE_PATH"]);
  });

  it("returns null when no daemon runs", () => {
    expect(daemonEnvMissing(env, { pidFiles: ["/nonexistent/app-server.pid"] })).toBeNull();
    expect(daemonEnvMissing(env, { pidFiles: pidFiles(1), readEnv: () => "" })).toBeNull();
  });
});
