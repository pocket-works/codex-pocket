import { describe, expect, it } from "vitest";
import { defaultSocketPath, ensureDaemon } from "../src/codex/locate.js";

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

  it("fails loudly when no socket path is reported", async () => {
    await expect(ensureDaemon(async () => '{"status":"weird"}')).rejects.toThrow(/socketPath/);
    await expect(ensureDaemon(async () => "not json")).rejects.toThrow(/unexpected output/);
  });
});
