import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceName, pairComputer, pairingCodeFromScan, redeemPairingCode } from "../src/state/auth.js";

afterEach(() => vi.unstubAllGlobals());

describe("redeemPairingCode", () => {
  function mockBrowser() {
    vi.stubGlobal("navigator", { userAgent: "iPhone" });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("location", { origin: "https://mac.test" });
  }

  it("explains how to recover when the host is unreachable", async () => {
    mockBrowser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(redeemPairingCode("ABCD-EFGH")).rejects.toThrow("Can't reach your computer. Make sure Codex Pocket is running and try pairing again.");
  });

  it("still identifies invalid pairing codes separately", async () => {
    mockBrowser();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
    await expect(redeemPairingCode("ABCD-EFGH")).rejects.toThrow("Pairing code is invalid or expired");
  });

  it("explains how to recover when adding an unreachable computer", async () => {
    mockBrowser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(pairComputer("https://other-mac.test", "ABCD-EFGH")).rejects.toThrow("Can't reach your computer. Make sure Codex Pocket is running and try pairing again.");
  });
});

describe("pairingCodeFromScan", () => {
  it("takes the code from a pairing link or a bare typed code", () => {
    expect(pairingCodeFromScan("https://mac.ts.net/#pair=N7H4-68S7")).toBe("N7H4-68S7");
    expect(pairingCodeFromScan("https://mac.ts.net/#pair=N7H468S7&x=1")).toBe("N7H468S7");
    expect(pairingCodeFromScan(" n7h4-68s7 ")).toBe("n7h4-68s7");
    expect(pairingCodeFromScan("https://example.com/")).toBeNull();
  });
});

describe("deviceName", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

  it("says whether the Home Screen app or a browser tab paired", () => {
    expect(deviceName(iphone, true)).toBe("iPhone (Home Screen)");
    expect(deviceName(iphone, false)).toBe("iPhone (browser)");
    expect(deviceName(mac, false)).toBe("Mac (browser)");
  });
});
