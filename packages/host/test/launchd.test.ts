import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DESKTOP_BRIDGE_LABEL,
  LEGACY_SHARED_APP_SERVER_LABEL,
  desktopBridgeAgentInstalled,
  installDesktopBridge,
  restoreSharedAppServer,
  retireSharedAppServer,
  unlinkDesktop,
} from "../src/launchd.js";

describe("desktop LaunchAgents", () => {
  const original = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    CODEX_POCKET_HOME: process.env.CODEX_POCKET_HOME,
    TEST_LAUNCHCTL_CALLS: process.env.TEST_LAUNCHCTL_CALLS,
    TEST_LAUNCHCTL_FAIL_BOOTSTRAP: process.env.TEST_LAUNCHCTL_FAIL_BOOTSTRAP,
  };
  let home: string;
  let calls: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "pocket-launchd-"));
    const bin = join(home, "bin");
    mkdirSync(bin);
    calls = join(home, "launchctl-calls.jsonl");
    writeFileSync(join(bin, "launchctl"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_LAUNCHCTL_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "bootstrap" && process.env.TEST_LAUNCHCTL_FAIL_BOOTSTRAP) process.exit(1);
`, { mode: 0o755 });
    process.env.HOME = home;
    process.env.PATH = `${bin}:${original.PATH}`;
    process.env.CODEX_POCKET_HOME = join(home, ".codex-pocket");
    process.env.TEST_LAUNCHCTL_CALLS = calls;
    delete process.env.TEST_LAUNCHCTL_FAIL_BOOTSTRAP;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const recorded = () => readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  const plist = (label: string) => join(home, "Library", "LaunchAgents", `${label}.plist`);

  it("installs an independent bridge and removes it on unlink", () => {
    const file = installDesktopBridge(["/bin/zsh", "-lic", "exec node", "node", "/tmp/cli.js", "desktop-bridge", "--port", "7355"]);
    expect(file).toBe(plist(DESKTOP_BRIDGE_LABEL));
    expect(desktopBridgeAgentInstalled()).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("<key>KeepAlive</key><true/>");
    expect(recorded()).toEqual([["bootstrap", `gui/${process.getuid?.() ?? 501}`, file]]);

    expect(unlinkDesktop()).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(recorded().slice(1)).toEqual([
      ["bootout", `gui/${process.getuid?.() ?? 501}/${DESKTOP_BRIDGE_LABEL}`],
      ["unsetenv", "CODEX_APP_SERVER_WS_URL"],
      ["getenv", "CODEX_APP_SERVER_WS_URL"],
    ]);
  });

  it("removes a failed first-install plist", () => {
    process.env.TEST_LAUNCHCTL_FAIL_BOOTSTRAP = "1";
    expect(() => installDesktopBridge(["/bin/zsh", "-lic", "exit 1"])).toThrow();
    expect(desktopBridgeAgentInstalled()).toBe(false);
  });

  it("can restore the retired shared app-server after a failed migration", () => {
    const file = plist(LEGACY_SHARED_APP_SERVER_LABEL);
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(file, "old shared app-server plist");
    const previous = retireSharedAppServer();
    expect(previous).toBe("old shared app-server plist");
    expect(existsSync(file)).toBe(false);
    restoreSharedAppServer(previous!);
    expect(readFileSync(file, "utf8")).toBe(previous);
    expect(recorded()).toEqual([
      ["bootout", `gui/${process.getuid?.() ?? 501}/${LEGACY_SHARED_APP_SERVER_LABEL}`],
      ["bootstrap", `gui/${process.getuid?.() ?? 501}`, file],
    ]);
  });
});
