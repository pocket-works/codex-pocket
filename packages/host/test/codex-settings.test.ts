import { describe, expect, it } from "vitest";
import { DEFAULT_CODEX_SETTINGS, parseCodexSettings, parsePublicUrl, setSetting, unsetSetting } from "../src/config/settings.js";
import { desktopBridgePlist, DESKTOP_BRIDGE_LABEL } from "../src/launchd.js";

describe("parseCodexSettings", () => {
  it("defaults to the desktop bridge port", () => {
    expect(parseCodexSettings({})).toEqual(DEFAULT_CODEX_SETTINGS);
    expect(DEFAULT_CODEX_SETTINGS).toEqual({ port: 7355 });
  });

  it("accepts a custom port", () => {
    expect(parseCodexSettings({ port: 8000 })).toEqual({ port: 8000 });
  });

  it("ignores the retired shared-mode keys", () => {
    expect(parseCodexSettings({ mode: "shared", binary: "/x/codex", port: 7355 })).toEqual({ port: 7355 });
  });

  it("rejects bad ports", () => {
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

describe("desktopBridgePlist", () => {
  it("keeps the desktop bridge alive across Pocket quits and user logins", () => {
    const xml = desktopBridgePlist(["/bin/zsh", "-lic", 'exec node "$@"', "node", "/path with spaces/cli.js", "desktop-bridge", "--port", "7355"], { CODEX_POCKET_HOME: "/other home" });
    expect(xml).toContain(`<string>${DESKTOP_BRIDGE_LABEL}</string>`);
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).toContain("<string>/path with spaces/cli.js</string>");
    expect(xml).toContain("<string>7355</string>");
    expect(xml).toContain("<key>CODEX_POCKET_HOME</key><string>/other home</string>");
  });
});
