import { describe, expect, it } from "vitest";
import { codexCliRunner, defaultSocketPath, ensureDaemon, loginShellCommand } from "../src/codex/locate.js";

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

  it("passes arguments through untouched", async () => {
    const run = codexCliRunner("/bin/echo", "/bin/sh");
    expect((await run(["app-server", "daemon", "start"])).trim()).toBe("app-server daemon start");
  });
});
