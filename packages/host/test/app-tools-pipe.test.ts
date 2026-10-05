import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appToolsDaemonEnv,
  appToolsLinkPath,
  createPipeLocator,
  mainLogPid,
  pipePathFromLog,
  pointLink,
  watchAppToolsPipe,
} from "../src/codex/app-tools-pipe.js";

const UUID = "399630fe-2728-4302-a130-607685482229";
const line = (pipe: string) =>
  `2026-09-22T23:40:12.336Z info [dynamic-app-tools-native-pipe] dynamic_app_tools_listening pipePath=${pipe}\n`;

describe("appToolsDaemonEnv", () => {
  const fakeApp = (node = "#!/bin/sh\nexec node \"$@\"\n") => {
    const app = mkdtempSync(join(tmpdir(), "ChatGPT.app-"));
    const bin = join(app, "Contents", "Resources", "cua_node", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "node"), node, { mode: 0o755 });
    return { app, node: join(bin, "node") };
  };

  it("hands the MCP the fixed pipe path and a shim over the desktop app's own node", () => {
    const home = mkdtempSync(join(tmpdir(), "pocket-"));
    const { app, node } = fakeApp();
    const env = appToolsDaemonEnv([join(tmpdir(), "missing.app"), app], home);
    expect(env).toEqual({ CODEX_APP_TOOLS_PIPE_PATH: appToolsLinkPath(home), CODEX_MCP_NODE_PATH: join(home, "app-tools-node") });
    const shim = readFileSync(env.CODEX_MCP_NODE_PATH, "utf8");
    expect(shim).toContain(`exec '${node}' -e`);
    expect(statSync(env.CODEX_MCP_NODE_PATH).mode & 0o111).not.toBe(0);
  });

  it("leaves the node out when ChatGPT is not installed", () => {
    const home = mkdtempSync(join(tmpdir(), "pocket-"));
    expect(appToolsDaemonEnv([join(tmpdir(), "missing.app")], home)).toEqual({ CODEX_APP_TOOLS_PIPE_PATH: appToolsLinkPath(home) });
  });

  it("runs the server as a child of node, passing arguments, stdio and exit status through", () => {
    const home = mkdtempSync(join(tmpdir(), "pocket-"));
    const { app } = fakeApp(`#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
    const shim = appToolsDaemonEnv([app], home).CODEX_MCP_NODE_PATH;
    const server = join(home, "server.mjs");
    writeFileSync(server, 'process.stdin.on("data", (d) => { process.stdout.write(`${process.argv[2]}:${process.ppid !== 1}:${d}`); process.exit(3); });');
    const r = spawnSync(shim, [server, "arg"], { input: "hi", encoding: "utf8", timeout: 10_000 });
    expect(r.error).toBeUndefined();
    expect(r.stdout).toBe("arg:true:hi");
    expect(r.status).toBe(3);
  });
});

describe("mainLogPid", () => {
  it("reads the pid of a main-process log", () => {
    expect(mainLogPid(`codex-desktop-${UUID}-97112-t0-i1-234011-0.log`)).toBe(97112);
  });

  it("skips other processes' logs and other files", () => {
    expect(mainLogPid(`codex-desktop-${UUID}-97112-t1-i1-234016-0.log`)).toBeNull();
    expect(mainLogPid("notes.txt")).toBeNull();
  });
});

describe("pipePathFromLog", () => {
  it("finds the last pipe the app opened", () => {
    const text = `noise\n${line("/tmp/codex-browser-use/a.sock")}more\n${line("/tmp/codex-browser-use/b.sock")}`;
    expect(pipePathFromLog(text)).toBe("/tmp/codex-browser-use/b.sock");
  });

  it("returns null when the app has not opened one", () => {
    expect(pipePathFromLog("2026-09-22T23:40:12.431Z info [AppServerConnection] Starting\n")).toBeNull();
  });
});

describe("createPipeLocator", () => {
  let root: string;
  const now = () => new Date("2026-09-23T08:00:00Z");
  const day = (d: string) => {
    const dir = join(root, "2026", "09", d);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const writeLog = (dir: string, pid: number, text: string, mtime = 0) => {
    const file = join(dir, `codex-desktop-${UUID}-${pid}-t0-i1-234011-0.log`);
    writeFileSync(file, text);
    if (mtime) utimesSync(file, mtime, mtime);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "app-tools-logs-"));
  });

  it("finds the pipe of a running app, in an earlier UTC day folder too", () => {
    writeLog(day("22"), 97112, line("/tmp/p/live.sock"));
    const locate = createPipeLocator({ logsDir: root, now, isAlive: () => true, exists: () => true });
    expect(locate()).toBe("/tmp/p/live.sock");
  });

  it("ignores apps that have quit and pipes that are gone", () => {
    const dir = day("23");
    writeLog(dir, 1, line("/tmp/p/dead-app.sock"));
    writeLog(dir, 2, line("/tmp/p/removed.sock"));
    const locate = createPipeLocator({
      logsDir: root,
      now,
      isAlive: (pid) => pid !== 1,
      exists: (p) => p !== "/tmp/p/removed.sock",
    });
    expect(locate()).toBeNull();
  });

  it("prefers the most recently started app", () => {
    const dir = day("23");
    writeLog(dir, 10, line("/tmp/p/old.sock"), 1_000);
    writeLog(dir, 11, line("/tmp/p/new.sock"), 2_000);
    const locate = createPipeLocator({ logsDir: root, now, isAlive: () => true, exists: () => true });
    expect(locate()).toBe("/tmp/p/new.sock");
  });

  it("picks the pipe up once the app gets around to logging it", () => {
    const dir = day("23");
    writeLog(dir, 12, "starting\n");
    const locate = createPipeLocator({ logsDir: root, now, isAlive: () => true, exists: () => true });
    expect(locate()).toBeNull();
    writeLog(dir, 12, `starting\n${line("/tmp/p/late.sock")}`);
    expect(locate()).toBe("/tmp/p/late.sock");
  });

  it("returns null without any logs", () => {
    expect(createPipeLocator({ logsDir: join(root, "missing"), now })()).toBeNull();
  });
});

describe("watchAppToolsPipe", () => {
  let dir: string;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "app-tools-link-"));
  });
  afterEach(() => stop?.());

  it("points the link at the running app's pipe and follows it to a new launch", () => {
    const link = join(dir, "home", "app-tools.sock");
    let pipe: string | null = "/tmp/p/first.sock";
    const logs: string[] = [];
    const watcher = watchAppToolsPipe({ link, locate: () => pipe, log: (m) => logs.push(m), intervalMs: 60_000 });
    stop = watcher.stop;
    expect(readlinkSync(link)).toBe("/tmp/p/first.sock");

    pipe = "/tmp/p/second.sock";
    watcher.refresh();
    expect(readlinkSync(link)).toBe("/tmp/p/second.sock");
    expect(logs).toHaveLength(2);
  });

  it("leaves the last link in place while no app is running", () => {
    const link = join(dir, "app-tools.sock");
    pointLink(link, "/tmp/p/earlier.sock");
    const watcher = watchAppToolsPipe({ link, locate: () => null, intervalMs: 60_000 });
    stop = watcher.stop;
    expect(readlinkSync(link)).toBe("/tmp/p/earlier.sock");
  });
});
