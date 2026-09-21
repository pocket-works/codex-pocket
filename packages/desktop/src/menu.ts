import type { Device } from "./admin.js";
import type { HostState } from "./supervisor.js";
import type { Rgb } from "./icons.js";

// The tray menu as plain data, so what the user sees for each state can be
// tested without Electron. main.ts turns it into a real Menu.

export type MenuAction = "start" | "stop" | "restart" | "pair" | "log" | "quit" | { revoke: string };

export interface MenuItem {
  label: string;
  enabled?: boolean;
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

export function buildMenu(state: HostState, devices: Device[]): MenuEntry[] {
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
  const deviceItems: MenuItem[] =
    devices.length === 0
      ? [{ label: "No paired phones", enabled: false }]
      : devices.map((d) => ({ label: d.name, submenu: [{ label: `Paired ${fmt(d.createdAt)}`, enabled: false }, { label: `Last seen ${d.lastSeenAt ? fmt(d.lastSeenAt) : "never"}`, enabled: false }, { label: "Revoke", action: { revoke: d.id } }] }));
  return [
    ...head,
    "separator",
    { label: "Pair a phone…", action: "pair", enabled: running },
    { label: devices.length === 1 ? "1 paired phone" : `${devices.length} paired phones`, submenu: deviceItems, enabled: running },
    "separator",
    running || state.kind === "starting" ? { label: "Stop host", action: "stop" } : { label: "Start host", action: "start" },
    { label: "Restart host", action: "restart", enabled: running || state.kind === "error" },
    { label: "Open log", action: "log" },
    "separator",
    { label: "Quit Codex Pocket", action: "quit" },
  ];
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString();
}
