import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pocketHome } from "./config/paths.js";

export const DESKTOP_ENV_LABEL = "com.codex-pocket.desktop-env";
export const DESKTOP_BRIDGE_LABEL = "com.codex-pocket.desktop-bridge";
export const DESKTOP_ENV_VAR = "CODEX_APP_SERVER_WS_URL";
export const LEGACY_SHARED_APP_SERVER_LABEL = "com.codex-pocket.shared-app-server";
// An older host LaunchAgent can contend for the phone port. The retired
// shared app-server is removed by link-desktop when the bridge replaces it.
export const LEGACY_LAUNCHD_LABELS = ["com.codex-pocket.host"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistPath(label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function writeUserLaunchAgent(label: string, xml: string): string {
  const file = plistPath(label);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, xml, { mode: 0o600 });
  return file;
}

export function uninstallUserLaunchAgent(label: string): boolean {
  const file = plistPath(label);
  if (!existsSync(file)) return false;
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${label}`], { stdio: "inherit" });
  } catch {
    // Already unloaded.
  }
  unlinkSync(file);
  return true;
}

/** Removes the retired host LaunchAgent; returns the labels that were present. */
export function retireLegacyLaunchAgents(): string[] {
  return LEGACY_LAUNCHD_LABELS.filter((label) => uninstallUserLaunchAgent(label));
}

export function currentDesktopEnv(): string | null {
  try {
    const out = execFileSync("launchctl", ["getenv", DESKTOP_ENV_VAR], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function setDesktopEnv(url: string): void {
  execFileSync("launchctl", ["setenv", DESKTOP_ENV_VAR, url]);
}

export function clearDesktopEnv(): void {
  execFileSync("launchctl", ["unsetenv", DESKTOP_ENV_VAR]);
}

export function desktopBridgeReadyPath(): string {
  return join(pocketHome(), "desktop-bridge-ready.json");
}

export function desktopBridgeAgentInstalled(): boolean {
  return existsSync(plistPath(DESKTOP_BRIDGE_LABEL));
}

export function readDesktopBridgeAgent(): string | null {
  try {
    return readFileSync(plistPath(DESKTOP_BRIDGE_LABEL), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return null;
  }
}

export function desktopBridgePlist(args: string[], env: Record<string, string> = {}): string {
  const home = pocketHome();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${DESKTOP_BRIDGE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map((arg) => `<string>${esc(arg)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key>
  <dict>${Object.entries(env).map(([key, value]) => `<key>${esc(key)}</key><string>${esc(value)}</string>`).join("")}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${esc(join(home, "desktop-bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(join(home, "desktop-bridge.log"))}</string>
</dict>
</plist>
`;
}

export function desktopBridgeAgentMatches(args: string[], env: Record<string, string> = {}): boolean {
  return readDesktopBridgeAgent() === desktopBridgePlist(args, env);
}

export function restoreDesktopBridge(plist: string): void {
  const file = writeUserLaunchAgent(DESKTOP_BRIDGE_LABEL, plist);
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 501}`, file]);
}

export function installDesktopBridge(args: string[], env: Record<string, string> = {}): string {
  const file = plistPath(DESKTOP_BRIDGE_LABEL);
  const previous = readDesktopBridgeAgent();
  mkdirSync(pocketHome(), { recursive: true, mode: 0o700 });
  if (previous !== null) {
    try {
      execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${DESKTOP_BRIDGE_LABEL}`]);
    } catch {
      // A plist may exist without a loaded job.
    }
  }
  rmSync(desktopBridgeReadyPath(), { force: true });
  const path = writeUserLaunchAgent(DESKTOP_BRIDGE_LABEL, desktopBridgePlist(args, env));
  try {
    execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 501}`, path]);
  } catch (err) {
    unlinkSync(path);
    if (previous !== null) {
      try {
        restoreDesktopBridge(previous);
      } catch (restoreError) {
        throw new AggregateError([err, restoreError], "desktop bridge installation failed and the previous agent could not be restored");
      }
    }
    throw err;
  }
  return path;
}

export function retireDesktopEnvAgent(): boolean {
  return uninstallUserLaunchAgent(DESKTOP_ENV_LABEL);
}

export function retireSharedAppServer(): string | null {
  const file = plistPath(LEGACY_SHARED_APP_SERVER_LABEL);
  if (!existsSync(file)) return null;
  const plist = readFileSync(file, "utf8");
  uninstallUserLaunchAgent(LEGACY_SHARED_APP_SERVER_LABEL);
  return plist;
}

export function restoreSharedAppServer(plist: string): void {
  const file = writeUserLaunchAgent(LEGACY_SHARED_APP_SERVER_LABEL, plist);
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 501}`, file]);
}

export function removeDesktopBridge(): boolean {
  const removed = uninstallUserLaunchAgent(DESKTOP_BRIDGE_LABEL);
  const ready = desktopBridgeReadyPath();
  if (existsSync(ready)) unlinkSync(ready);
  return removed;
}

export function unlinkDesktop(): boolean {
  const legacy = retireDesktopEnvAgent();
  const bridge = removeDesktopBridge();
  try {
    clearDesktopEnv();
  } catch (err) {
    if (currentDesktopEnv()) throw err;
  }
  if (currentDesktopEnv()) throw new Error(`${DESKTOP_ENV_VAR} is still set after unlinking`);
  return legacy || bridge;
}
