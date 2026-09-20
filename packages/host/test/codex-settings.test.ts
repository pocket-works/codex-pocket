import { describe, expect, it } from "vitest";
import { DEFAULT_CODEX_SETTINGS, parseCodexSettings, parsePublicUrl, setSetting, unsetSetting } from "../src/config/settings.js";
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

describe("parsePublicUrl", () => {
  it("keeps an http(s) origin without a trailing slash", () => {
    expect(parsePublicUrl("https://mac.tailnet.ts.net/")).toBe("https://mac.tailnet.ts.net");
    expect(parsePublicUrl("http://10.0.0.2:7333")).toBe("http://10.0.0.2:7333");
  });

  it("rejects anything that is not an http(s) origin", () => {
    expect(() => parsePublicUrl("mac.tailnet.ts.net")).toThrow(/publicUrl/);
    expect(() => parsePublicUrl("https://mac.tailnet.ts.net/app")).toThrow(/publicUrl/);
    expect(() => parsePublicUrl(42)).toThrow(/publicUrl/);
  });
});

describe("config set/unset", () => {
  it("validates and stores the known keys", () => {
    let s = setSetting({}, "publicUrl", "https://mac.tailnet.ts.net/");
    s = setSetting(s, "bindHost", " 127.0.0.1 ");
    s = setSetting(s, "outboundProxy", "http://127.0.0.1:1082");
    expect(s).toEqual({ publicUrl: "https://mac.tailnet.ts.net", bindHost: "127.0.0.1", outboundProxy: "http://127.0.0.1:1082" });
    expect(unsetSetting(s, "publicUrl")).toEqual({ bindHost: "127.0.0.1", outboundProxy: "http://127.0.0.1:1082" });
  });

  it("rejects unknown keys and bad values", () => {
    expect(() => setSetting({}, "colour", "red")).toThrow(/unknown setting/);
    expect(() => setSetting({}, "bindHost", "")).toThrow(/bindHost/);
    expect(() => setSetting({}, "bindHost", "10.0.0.1 evil")).toThrow(/bindHost/);
    expect(() => setSetting({}, "outboundProxy", "127.0.0.1:1082")).toThrow(/outboundProxy/);
    expect(() => setSetting({}, "outboundProxy", "socks5://127.0.0.1:1080")).toThrow(/outboundProxy/);
    expect(() => unsetSetting({}, "codex")).toThrow(/unknown setting/);
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
