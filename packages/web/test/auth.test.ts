import { describe, expect, it } from "vitest";
import { pairingCodeFromScan } from "../src/state/auth.js";

describe("pairingCodeFromScan", () => {
  it("takes the code from a pairing link or a bare typed code", () => {
    expect(pairingCodeFromScan("https://mac.ts.net/#pair=N7H4-68S7")).toBe("N7H4-68S7");
    expect(pairingCodeFromScan("https://mac.ts.net/#pair=N7H468S7&x=1")).toBe("N7H468S7");
    expect(pairingCodeFromScan(" n7h4-68s7 ")).toBe("n7h4-68s7");
    expect(pairingCodeFromScan("https://example.com/")).toBeNull();
  });
});
