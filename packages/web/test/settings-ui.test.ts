import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/state/session.js";
import { createStore } from "../src/state/store.js";
import { SettingsScreen } from "../src/ui/SettingsScreen.js";

vi.mock("../src/state/dictation.js", () => ({ dictationSupported: () => false }));

beforeEach(() => {
  vi.stubGlobal("location", { host: "pocket.example" });
  vi.stubGlobal("window", { isSecureContext: true });
});

afterEach(() => vi.unstubAllGlobals());

describe("Settings version", () => {
  it.each(["open", "closed"])("shows the loaded build version when the connection is %s", (connection) => {
    const session = { store: createStore({ connection, upstreamConnected: connection === "open" }) } as unknown as Session;
    const html = renderToStaticMarkup(createElement(SettingsScreen, { session }));
    expect(import.meta.env.VITE_APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
    expect(html).toContain(`Version</span><span class="setting-value muted">${import.meta.env.VITE_APP_VERSION}</span>`);
    expect(html.indexOf("Version")).toBeLessThan(html.indexOf("Host"));
  });
});
