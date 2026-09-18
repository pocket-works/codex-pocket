import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pocketHome } from "./config/paths.js";

export const LAUNCHD_LABEL = "com.codex-pocket.host";
export const DESKTOP_ENV_LABEL = "com.codex-pocket.desktop-env";
export const DESKTOP_ENV_VAR = "CODEX_APP_SERVER_WS_URL";

export interface PlistOptions {
  label: string;
  node: string;
  script: string;
  logFile: string;
  home: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// launchd agents start with an empty environment, so HOME and PATH are set
// explicitly; `codex` (used to locate the app-server) must be on that PATH.
export function launchAgentPlist(o: PlistOptions): string {
  const path = [join(o.home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(o.node)}</string>
    <string>${esc(o.script)}</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${esc(o.home)}</string>
    <key>PATH</key>
    <string>${esc(path)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${esc(o.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(o.logFile)}</string>
</dict>
</plist>
`;
}

function plistPath(label = LAUNCHD_LABEL): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
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
  const file = plistPath(DESKTOP_ENV_LABEL);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, desktopEnvPlist(url));
  return file;
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

function builtCli(): string {
  // src/launchd.ts -> dist/launchd.js at runtime; the CLI sits next to it.
  const here = dirname(fileURLToPath(import.meta.url));
  const script = resolve(here, "cli.js");
  if (!existsSync(script) || here.endsWith("/src")) {
    throw new Error("launchd needs the built CLI: run `pnpm build` first, then `node packages/host/dist/cli.js install`");
  }
  return script;
}

function launchctl(...args: string[]): void {
  execFileSync("launchctl", args, { stdio: "inherit" });
}

export function installLaunchAgent(): string {
  const file = plistPath();
  mkdirSync(dirname(file), { recursive: true });
  const xml = launchAgentPlist({
    label: LAUNCHD_LABEL,
    node: process.execPath,
    script: builtCli(),
    logFile: join(pocketHome(), "host.log"),
    home: homedir(),
  });
  if (existsSync(file)) {
    try {
      launchctl("bootout", `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`);
    } catch {
      // Not loaded: nothing to unload.
    }
  }
  writeFileSync(file, xml);
  launchctl("bootstrap", `gui/${process.getuid?.() ?? 501}`, file);
  return file;
}

export function uninstallLaunchAgent(): boolean {
  const file = plistPath();
  if (!existsSync(file)) return false;
  try {
    launchctl("bootout", `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`);
  } catch {
    // Already unloaded.
  }
  unlinkSync(file);
  return true;
}
