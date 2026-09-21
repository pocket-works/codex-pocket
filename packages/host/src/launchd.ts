import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DESKTOP_ENV_LABEL = "com.codex-pocket.desktop-env";
export const DESKTOP_ENV_VAR = "CODEX_APP_SERVER_WS_URL";
// Retired: older versions kept the host (and before that, their own
// app-server) alive under launchd. The desktop app owns the host now, so
// `serve` boots these out if it finds them.
export const LEGACY_LAUNCHD_LABELS = ["com.codex-pocket.host", "com.codex-pocket.shared-app-server"];

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

/** Removes every LaunchAgent older versions installed; returns the labels that were present. */
export function retireLegacyLaunchAgents(): string[] {
  return LEGACY_LAUNCHD_LABELS.filter((label) => uninstallUserLaunchAgent(label));
}

// The ChatGPT desktop app reads CODEX_APP_SERVER_WS_URL and, when set,
// connects to that app-server instead of spawning a private one. GUI apps
// inherit launchd's environment, so `launchctl setenv` at login is enough.
export function desktopEnvPlist(url: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(DESKTOP_ENV_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>${esc(DESKTOP_ENV_VAR)}</string>
    <string>${esc(url)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

export function currentDesktopEnv(): string | null {
  try {
    const out = execFileSync("launchctl", ["getenv", DESKTOP_ENV_VAR], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Sets the variable now and installs an agent that sets it again at login.
export function linkDesktop(url: string): string {
  execFileSync("launchctl", ["setenv", DESKTOP_ENV_VAR, url]);
  return writeUserLaunchAgent(DESKTOP_ENV_LABEL, desktopEnvPlist(url));
}

export function unlinkDesktop(): boolean {
  try {
    execFileSync("launchctl", ["unsetenv", DESKTOP_ENV_VAR]);
  } catch {
    // Not set.
  }
  const file = plistPath(DESKTOP_ENV_LABEL);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}
