import type { Device } from "./admin.js";
import type { HostState } from "./supervisor.js";
import type { Rgb } from "./icons.js";

// The tray menu as plain data, so what the user sees for each state can be
// tested without Electron. main.ts turns it into a real Menu.

export type MenuAction = "start" | "stop" | "restart" | "pair" | "keep-awake" | "log" | "quit" | "revoke-stale" | "link-desktop" | "unlink-desktop" | { revoke: string };

export interface MenuItem {
  label: string;
  enabled?: boolean;
  /** Set on checkbox items only. */
  checked?: boolean;
  action?: MenuAction;
  submenu?: MenuItem[];
}

export type MenuEntry = MenuItem | "separator";

export const COLORS: Record<HostState["kind"], Rgb> = {
  stopped: [0x9a, 0x9a, 0x9a],
  starting: [0xf0, 0xb4, 0x29],
  running: [0x30, 0xc4, 0x5e],
  error: [0xe5, 0x48, 0x48],
};

export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Green means a phone can use it right now, which needs the Codex daemon
// too; a host that is up but cut off from Codex shows the "starting" amber.
export function trayColor(state: HostState): Rgb {
  if (state.kind === "running" && !state.status.codexConnected) return COLORS.starting;
  return COLORS[state.kind];
}

export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, now - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.round(s / 86_400)} d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

export function staleDevices(devices: Device[], now: number): Device[] {
  return devices.filter((d) => now - d.lastSeenAt >= STALE_AFTER_MS);
}

export function trayTooltip(state: HostState): string {
  switch (state.kind) {
    case "stopped":
      return "Codex Pocket: stopped";
    case "starting":
      return "Codex Pocket: starting…";
    case "running":
      return `Codex Pocket: ${state.status.publicUrl ?? "running"}`;
    case "error":
      return `Codex Pocket: ${state.message}`;
  }
}

export function buildMenu(state: HostState, devices: Device[], now = Date.now(), keepAwake = false, desktopLinked = false, desktopBusy = false): MenuEntry[] {
  const running = state.kind === "running";
  const head: MenuEntry[] = [];
  switch (state.kind) {
    case "stopped":
      head.push({ label: "Host stopped", enabled: false });
      break;
    case "starting":
      head.push({ label: "Host starting…", enabled: false });
      break;
    case "running":
      head.push({ label: `Host running at ${state.status.publicUrl ?? "?"}`, enabled: false });
      head.push({ label: state.status.codexConnected ? "Codex daemon: connected" : "Codex daemon: not connected", enabled: false });
      break;
    case "error":
      head.push({ label: `Host error: ${state.message}`, enabled: false });
      break;
  }
  // Phones mostly share a name ("iPhone"), so the last-seen time and push
  // registration are what tell them apart; the live one sorts first.
  const sorted = [...devices].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const deviceItems: MenuItem[] =
    devices.length === 0
      ? [{ label: "No paired phones", enabled: false }]
      : [
          ...sorted.map((d) => ({
            label: `${d.name} · ${relativeTime(d.lastSeenAt, now)}${d.push ? " · push" : ""}`,
            submenu: [{ label: `Paired ${fmt(d.createdAt)}`, enabled: false }, { label: `Last seen ${fmt(d.lastSeenAt)}`, enabled: false }, { label: "Revoke", action: { revoke: d.id } }],
          })),
          { label: "Revoke phones not seen in 7 days", action: "revoke-stale", enabled: staleDevices(devices, now).length > 0 },
        ];
  return [
    ...head,
    "separator",
    { label: "Pair a phone…", action: "pair", enabled: running },
    { label: devices.length === 1 ? "1 paired phone" : `${devices.length} paired phones`, submenu: deviceItems, enabled: running },
    "separator",
    { label: desktopLinked ? "Desktop sharing: linked" : "Desktop sharing: not linked", submenu: [
      { label: desktopLinked ? "Relink desktop…" : "Link desktop…", action: "link-desktop", enabled: !desktopBusy },
      { label: "Unlink desktop…", action: "unlink-desktop", enabled: desktopLinked && !desktopBusy },
    ] },
    "separator",
    running || state.kind === "starting" ? { label: "Stop host", action: "stop" } : { label: "Start host", action: "start" },
    { label: "Restart host", action: "restart", enabled: running || state.kind === "error" },
    { label: "Keep this Mac awake", action: "keep-awake", checked: keepAwake },
    { label: "Open log", action: "log" },
    "separator",
    { label: "Quit Codex Pocket", action: "quit" },
  ];
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString();
}
