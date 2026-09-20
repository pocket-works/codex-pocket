import { describe, expect, it } from "vitest";
import { desktopCompat } from "../src/codex/desktop-compat.js";

const account = { type: "chatgpt", email: "a@b.c", planType: "free" };

describe("desktopCompat", () => {
  it("accepts an app-server that reports workspaceRouting", () => {
    const routing = { chatgptAccountId: "x", backendOrigin: "https://chatgpt.com", accountRoutingOverride: "NO_CONSTRAINT" };
    expect(desktopCompat({ account, requiresOpenaiAuth: true, workspaceRouting: routing })).toEqual({ ok: true });
  });

  it("rejects an app-server without workspaceRouting and names the version", () => {
    const r = desktopCompat({ account, requiresOpenaiAuth: true }, "0.155.1");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/workspaceRouting/);
    expect(r.reason).toMatch(/0\.155\.1/);
  });

  it("rejects a signed-out daemon", () => {
    expect(desktopCompat({ account: null, requiresOpenaiAuth: true }).reason).toMatch(/not signed in/);
  });

  it("rejects an empty response", () => {
    expect(desktopCompat(undefined).ok).toBe(false);
  });
});
