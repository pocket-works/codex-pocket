import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostState } from "./supervisor.js";

// "Keep this Mac awake": while the host is up, a phone may start a turn at
// any time and a running turn should not stall because the Mac idled into
// sleep. Only system sleep is held off; the display still turns off.
// Electron-free so the bookkeeping can be tested on its own.

/** The slice of Electron's powerSaveBlocker this needs. */
export interface PowerBlocker {
  start(): number;
  stop(id: number): void;
}

export class KeepAwake {
  private id: number | null = null;

  constructor(private readonly blocker: PowerBlocker) {}

  get active(): boolean {
    return this.id !== null;
  }

  set(want: boolean): void {
    if (want && this.id === null) this.id = this.blocker.start();
    else if (!want && this.id !== null) {
      this.blocker.stop(this.id);
      this.id = null;
    }
  }
}

export function wantsAwake(enabled: boolean, state: HostState): boolean {
  return enabled && state.kind !== "stopped";
}

/** The menu bar app's own settings, next to the host's state. */
export interface DesktopPrefs {
  keepAwake: boolean;
}

const DEFAULTS: DesktopPrefs = { keepAwake: false };

function prefsFile(home: string): string {
  return join(home, "desktop.json");
}

export function readPrefs(home: string): DesktopPrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsFile(home), "utf8")) as Partial<DesktopPrefs>;
    return { keepAwake: raw.keepAwake === true };
  } catch {
    // Missing or unreadable: start from the defaults.
    return { ...DEFAULTS };
  }
}

export function writePrefs(home: string, prefs: DesktopPrefs): void {
  writeFileSync(prefsFile(home), JSON.stringify(prefs, null, 2) + "\n", { mode: 0o600 });
}
