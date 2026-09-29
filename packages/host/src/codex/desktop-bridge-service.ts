import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { watchAppToolsPipe } from "./app-tools-pipe.js";
import { CodexClient } from "./codex-client.js";
import { bridgeUrl, startDaemonBridge } from "./daemon-bridge.js";
import { ensureDaemon } from "./locate.js";
import { currentDesktopEnv, desktopBridgeAgentInstalled, desktopBridgeReadyPath, setDesktopEnv } from "../launchd.js";

export interface DesktopBridgeReady {
  pid: number;
  port: number;
}

export interface DesktopBridgeOptions {
  port: number;
  socketPath: string;
  readyPath?: string;
  setEnv?: (url: string) => void;
  watchAppTools?: () => { stop(): void };
  log?: (message: string) => void;
}

function readReady(): DesktopBridgeReady | null {
  try {
    const value = JSON.parse(readFileSync(desktopBridgeReadyPath(), "utf8")) as DesktopBridgeReady;
    return Number.isInteger(value.pid) && Number.isInteger(value.port) ? value : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForDesktopBridge(port: number, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (desktopBridgeIsReady(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`desktop bridge did not start on ${bridgeUrl(port)}; check ${dirname(desktopBridgeReadyPath())}/desktop-bridge.log`);
}

export function desktopBridgeIsReady(port: number): boolean {
  const ready = readReady();
  return desktopBridgeAgentInstalled() && ready?.port === port && isAlive(ready.pid) && currentDesktopEnv() === bridgeUrl(port);
}

export async function startDesktopBridge(opts: DesktopBridgeOptions): Promise<{ close(): Promise<void> }> {
  const readyPath = opts.readyPath ?? desktopBridgeReadyPath();
  const log = opts.log ?? console.log;
  const bridge = await startDaemonBridge({ port: opts.port, socketPath: opts.socketPath, log });
  const appTools = (opts.watchAppTools ?? (() => watchAppToolsPipe({ log })))();
  try {
    const client = await CodexClient.connect({ url: bridgeUrl(bridge.port) });
    client.close();
    mkdirSync(dirname(readyPath), { recursive: true, mode: 0o700 });
    writeFileSync(readyPath, JSON.stringify({ pid: process.pid, port: bridge.port }), { mode: 0o600 });
    (opts.setEnv ?? setDesktopEnv)(bridgeUrl(bridge.port));
  } catch (err) {
    rmSync(readyPath, { force: true });
    appTools.stop();
    await bridge.close();
    throw err;
  }
  log(`desktop bridge ${bridgeUrl(bridge.port)} -> ${opts.socketPath}`);

  return { close: async () => {
    try {
      const ready = JSON.parse(readFileSync(readyPath, "utf8")) as DesktopBridgeReady;
      if (ready.pid === process.pid) rmSync(readyPath, { force: true });
    } catch {
      // The marker was already removed.
    }
    appTools.stop();
    await bridge.close();
  } };
}

export async function runDesktopBridge(port: number, log: (message: string) => void = console.log): Promise<void> {
  rmSync(desktopBridgeReadyPath(), { force: true });
  const daemon = await ensureDaemon();
  const bridge = await startDesktopBridge({ port, socketPath: daemon.socketPath, log });
  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await new Promise(() => {});
}
