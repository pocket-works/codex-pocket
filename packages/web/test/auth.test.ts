import { describe, expect, it } from "vitest";
import { deviceName, pairingCodeFromScan } from "../src/state/auth.js";

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
