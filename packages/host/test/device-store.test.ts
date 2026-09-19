import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeviceStore } from "../src/auth/device-store.js";

function freshStore(now = () => 1_000_000): DeviceStore {
  return new DeviceStore(join(mkdtempSync(join(tmpdir(), "cp-ds-")), "devices.json"), { now });
}

describe("DeviceStore pairing", () => {
  it("redeems a pairing code once and issues a verifiable token", async () => {
    const store = freshStore();
    const code = store.createPairingCode();
    const paired = await store.redeemPairingCode(code, "iPhone");
    expect(paired).not.toBeNull();
    expect(await store.verifyToken(paired!.token)).toMatchObject({ id: paired!.deviceId, name: "iPhone" });
    expect(await store.redeemPairingCode(code, "again")).toBeNull();
  });

  it("rejects unknown and expired codes", async () => {
    let t = 1_000_000;
    const store = freshStore(() => t);
    const code = store.createPairingCode({ ttlMs: 60_000 });
    t += 60_001;
    expect(await store.redeemPairingCode(code, "late")).toBeNull();
    expect(await store.redeemPairingCode("nope", "x")).toBeNull();
  });

  it("issues short codes a person can type, accepted in any case and with dashes", async () => {
    const store = freshStore();
    const code = store.createPairingCode();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(code).not.toMatch(/[01IO]/);
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
    expect(await store.redeemPairingCode(typed, "iPhone")).not.toBeNull();
  });

  it("voids outstanding codes after repeated wrong guesses", async () => {
    const store = freshStore();
    const code = store.createPairingCode();
    for (let i = 0; i < 5; i++) expect(await store.redeemPairingCode("ZZZZZZZZ", "x")).toBeNull();
    expect(await store.redeemPairingCode(code, "late")).toBeNull();
    // A fresh `pair` starts over.
    expect(await store.redeemPairingCode(store.createPairingCode(), "ok")).not.toBeNull();
  });

  it("rejects bad tokens and revoked devices", async () => {
    const store = freshStore();
    const paired = (await store.redeemPairingCode(store.createPairingCode(), "iPad"))!;
    expect(await store.verifyToken("garbage")).toBeNull();
    expect(await store.revoke(paired.deviceId)).toBe(true);
    expect(await store.verifyToken(paired.token)).toBeNull();
    expect(await store.revoke(paired.deviceId)).toBe(false);
  });

  it("persists devices across instances and never stores raw tokens", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "cp-ds-")), "devices.json");
    const a = new DeviceStore(path);
    const paired = (await a.redeemPairingCode(a.createPairingCode(), "Pixel"))!;
    const b = new DeviceStore(path);
    expect(await b.verifyToken(paired.token)).toMatchObject({ name: "Pixel" });
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path, "utf8")).not.toContain(paired.token);
    expect((await b.list()).map((d) => d.name)).toEqual(["Pixel"]);
  });
});
