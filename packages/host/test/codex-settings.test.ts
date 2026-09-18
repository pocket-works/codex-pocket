import { describe, expect, it } from "vitest";
import { DEFAULT_CODEX_SETTINGS, parseCodexSettings } from "../src/config/settings.js";
import { desktopEnvPlist, DESKTOP_ENV_LABEL } from "../src/launchd.js";

describe("parseCodexSettings", () => {
  it("defaults to shared mode on the default port", () => {
    expect(parseCodexSettings({})).toEqual(DEFAULT_CODEX_SETTINGS);
  });

  it("accepts daemon mode, custom port and binary", () => {
    expect(parseCodexSettings({ mode: "daemon", port: 8000, binary: "/x/codex" })).toEqual({ mode: "daemon", port: 8000, binary: "/x/codex" });
  });

  it("rejects unknown modes and bad ports", () => {
    expect(() => parseCodexSettings({ mode: "cloud" })).toThrow(/mode/);
    expect(() => parseCodexSettings({ port: 70000 })).toThrow(/port/);
  });
});

describe("desktopEnvPlist", () => {
  it("sets CODEX_APP_SERVER_WS_URL through launchctl at login", () => {
    const xml = desktopEnvPlist("ws://127.0.0.1:7355/");
    expect(xml).toContain(`<string>${DESKTOP_ENV_LABEL}</string>`);
    expect(xml).toContain("<string>setenv</string>");
    expect(xml).toContain("<string>CODEX_APP_SERVER_WS_URL</string>");
    expect(xml).toContain("<string>ws://127.0.0.1:7355/</string>");
    expect(xml).toContain("<key>RunAtLoad</key>");
  });
});
