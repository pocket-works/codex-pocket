import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, powerSaveBlocker, shell, Tray, utilityProcess, type MenuItemConstructorOptions } from "electron";
import { AdminClient, pocketHome, type Device } from "./admin.js";
import { encodePng, trayGlyph } from "./icons.js";
import { KeepAwake, readPrefs, wantsAwake, writePrefs } from "./keep-awake.js";
import { buildMenu, staleDevices, trayColor, trayTooltip, type MenuAction, type MenuEntry } from "./menu.js";
import { pairPageFor } from "./pair-page.js";
import { HostSupervisor, type HostChild, type HostState } from "./supervisor.js";

// Menu bar app that owns the host: launching it starts `serve`, quitting it
// stops `serve`. Nothing is left running in the background afterwards; the
// Codex daemon itself belongs to Codex and is only observed here.

const KILL_GRACE_MS = 5000;
const DEVICE_REFRESH_MS = 30_000;

interface HostLocation {
  script: string;
  args: string[];
}

// The host is the esbuild bundle from scripts/bundle.ts. Packaged, it and
// the web app sit under Resources; in development they are next to this
// file's bundle and in the workspace.
function hostLocation(): HostLocation {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return { script: join(res, "host", "cli.js"), args: ["serve", "--static", join(res, "web")] };
  }
  const build = dirname(fileURLToPath(import.meta.url));
  return { script: join(build, "host", "cli.js"), args: ["serve", "--static", resolve(build, "..", "..", "web", "dist")] };
}

function logFile(): string {
  return join(pocketHome(), "host.log");
}

function spawnHost(location: HostLocation, log: WriteStream): HostChild {
  const child = utilityProcess.fork(location.script, location.args, { stdio: ["ignore", "pipe", "pipe"], serviceName: "codex-pocket host" });
  log.write(`\n[desktop] ${new Date().toISOString()} starting ${location.script} ${location.args.join(" ")}\n`);
  child.stdout?.on("data", (d) => log.write(d));
  child.stderr?.on("data", (d) => log.write(d));
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  return {
    onExit: (handler) => child.on("exit", handler),
    kill: () => {
      child.kill();
      // `serve` exits on SIGTERM; if it is wedged, do not let it outlive us.
      setTimeout(() => {
        if (!exited && child.pid) {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            // Gone already.
          }
        }
      }, KILL_GRACE_MS).unref();
    },
  };
}

// The menu bar draws in one ink — black on a light bar, white on a dark
// one — and an app that ignores that reads as a sticker stuck among the
// system's own icons. A template image would follow the bar for free but
// strips every colour, including the status dot's, which is the one thing
// here worth colouring; so the ink is chosen by hand and the tray is
// redrawn when the theme changes. A stopped host fades the glyph.
const INK_ON_LIGHT: [number, number, number] = [0x1c, 0x1c, 0x1e];
const INK_ON_DARK: [number, number, number] = [0xff, 0xff, 0xff];
/** Point size of the glyph; the menu bar gives it about 24pt to sit in. */
const TRAY_SIZE_PT = 18;

function trayIcon(state: HostState): Electron.NativeImage {
  const glyph = nativeTheme.shouldUseDarkColors ? INK_ON_DARK : INK_ON_LIGHT;
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = TRAY_SIZE_PT * scale;
    const { rgba } = trayGlyph({ size, glyph, glyphAlpha: state.kind === "stopped" ? 0.45 : 1, dot: trayColor(state) });
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: encodePng(size, size, rgba) });
  }
  return img;
}

function toTemplate(entries: MenuEntry[], run: (action: MenuAction) => void): MenuItemConstructorOptions[] {
  return entries.map((e) => {
    if (e === "separator") return { type: "separator" };
    const item: MenuItemConstructorOptions = { label: e.label, enabled: e.enabled ?? true };
    if (e.checked !== undefined) Object.assign(item, { type: "checkbox", checked: e.checked });
    if (e.submenu) item.submenu = toTemplate(e.submenu, run);
    if (e.action) {
      const action = e.action;
      item.click = () => run(action);
    }
    return item;
  });
}

async function main(): Promise<void> {
  await app.whenReady();
  app.dock?.hide();
  mkdirSync(pocketHome(), { recursive: true, mode: 0o700 });
  const log = createWriteStream(logFile(), { flags: "a" });
  const admin = new AdminClient();
  const location = hostLocation();

  let devices: Device[] = [];
  const prefs = readPrefs(pocketHome());
  const awake = new KeepAwake({ start: () => powerSaveBlocker.start("prevent-app-suspension"), stop: (id) => powerSaveBlocker.stop(id) });
  let pairWindow: BrowserWindow | null = null;
  const tray = new Tray(trayIcon({ kind: "stopped" }));

  const render = () => {
    const state = supervisor.state;
    tray.setImage(trayIcon(state));
    tray.setToolTip(trayTooltip(state));
    awake.set(wantsAwake(prefs.keepAwake, state));
    tray.setContextMenu(Menu.buildFromTemplate(toTemplate(buildMenu(state, devices, Date.now(), prefs.keepAwake), (a) => void runAction(a))));
  };

  // Light/dark switched (by hand or at sunset): the glyph's ink follows.
  nativeTheme.on("updated", () => tray.setImage(trayIcon(supervisor.state)));

  const supervisor = new HostSupervisor({
    spawn: () => spawnHost(location, log),
    probe: () => admin.status(),
    onChange: async (state) => {
      devices = state.kind === "running" ? await admin.devices().catch(() => devices) : [];
      render();
    },
  });

  const refreshDevices = async () => {
    devices = await admin.devices().catch(() => []);
    render();
  };

  const showPairWindow = async () => {
    const html = await pairPageFor(await admin.pairingCode());
    if (!pairWindow) {
      pairWindow = new BrowserWindow({ width: 320, height: 440, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, title: "Pair a phone", show: false });
      pairWindow.on("closed", () => {
        pairWindow = null;
      });
      pairWindow.once("ready-to-show", () => pairWindow?.show());
    }
    await pairWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    pairWindow.show();
    pairWindow.focus();
  };

  const runAction = async (action: MenuAction) => {
    try {
      if (action === "start") supervisor.start();
      else if (action === "stop") await supervisor.stop();
      else if (action === "restart") await supervisor.restart();
      else if (action === "pair") await showPairWindow();
      else if (action === "keep-awake") {
        prefs.keepAwake = !prefs.keepAwake;
        writePrefs(pocketHome(), prefs);
        render();
      }
      else if (action === "log") await shell.openPath(logFile());
      else if (action === "quit") app.quit();
      else if (action === "revoke-stale") {
        const stale = staleDevices(devices, Date.now());
        const { response } = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Revoke", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          message: `Revoke ${stale.length} phone${stale.length === 1 ? "" : "s"} not seen in the last 7 days?`,
          detail: stale.map((d) => `${d.name} · last seen ${new Date(d.lastSeenAt).toLocaleString()}`).join("\n"),
        });
        if (response !== 0) return;
        for (const d of stale) await admin.revoke(d.id);
        await refreshDevices();
      } else if ("revoke" in action) {
        await admin.revoke(action.revoke);
        await refreshDevices();
      }
    } catch (err) {
      dialog.showErrorBox("Codex Pocket", err instanceof Error ? err.message : String(err));
    }
  };

  // Quitting must take the host down with us, so hold the quit until it has exited.
  let hostStopped = false;
  app.on("before-quit", (event) => {
    if (hostStopped) return;
    event.preventDefault();
    supervisor.stop().finally(() => {
      hostStopped = true;
      log.end();
      app.quit();
    });
  });
  // A menu bar app has no windows to keep it alive.
  app.on("window-all-closed", () => {});

  // Keep "last seen" honest while the menu sits open all day.
  setInterval(() => {
    if (supervisor.state.kind === "running") void refreshDevices();
  }, DEVICE_REFRESH_MS).unref();

  render();
  supervisor.start();
}

main().catch((err) => {
  dialog.showErrorBox("Codex Pocket failed to start", err instanceof Error ? err.stack ?? err.message : String(err));
  app.exit(1);
});
