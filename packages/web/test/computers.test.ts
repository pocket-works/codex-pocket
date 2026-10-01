// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerRegistry, normalizeOrigin } from "../src/state/computers.js";
import { hasUnconfirmedSend, loadDraft, saveDraft, setUnconfirmedSend } from "../src/state/drafts.js";
import { emptyDraft } from "../src/state/compose.js";
import { getPins, togglePin } from "../src/state/pins.js";
import { getLastModel, setLastModel } from "../src/state/model-prefs.js";
import { loadThreadReadiness, saveThreadReadiness } from "../src/state/thread-readiness.js";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());
const paired = (instanceId: string) => ({ token: `token-${instanceId}`, deviceId: `device-${instanceId}`, instanceId, host: instanceId });

describe("computer registry", () => {
  it("migrates the existing pairing and scoped data exactly once", () => {
    localStorage.setItem("codex-pocket.token", "legacy-token");
    saveDraft("new", { ...emptyDraft, text: "unsent" });
    togglePin("thread");
    setLastModel({ model: "model-a", effort: "high" });
    const first = new ComputerRegistry(localStorage, "https://entry.ts.net");
    const id = first.active!.id;
    expect(first.active!.token).toBe("legacy-token");
    expect(loadDraft("new", id).text).toBe("unsent");
    expect(getPins(id)).toEqual(["thread"]);
    expect(getLastModel(id)?.model).toBe("model-a");
    expect(localStorage.getItem("codex-pocket.token")).toBeNull();
    expect(loadDraft("new").text).toBe("");
    expect(getPins()).toEqual([]);
    expect(new ComputerRegistry(localStorage, "https://entry.ts.net").active!.id).toBe(id);
  });

  it("preserves migrated data when pairing reveals the host identity", () => {
    localStorage.setItem("codex-pocket.token", "legacy-token");
    saveDraft("new", { ...emptyDraft, text: "unsent" });
    const registry = new ComputerRegistry(localStorage, "https://entry.ts.net");
    const id = registry.active!.id;
    const computer = registry.add("https://entry.ts.net", paired("entry"));
    expect(computer).toMatchObject({ id, instanceId: "entry", token: "token-entry" });
    expect(registry.store.get().computers).toHaveLength(1);
    expect(loadDraft("new", id).text).toBe("unsent");
  });

  it("does not reuse data for a different host at the same address", () => {
    const registry = new ComputerRegistry(localStorage, "https://entry.ts.net");
    const a = registry.add("https://a.ts.net", paired("a"));
    saveDraft("new", { ...emptyDraft, text: "only-a" }, a.id);
    const b = registry.add("https://a.ts.net", paired("b"));
    expect(b.id).not.toBe(a.id);
    expect(registry.store.get().computers).toHaveLength(2);
    expect(loadDraft("new", b.id).text).toBe("");
    expect(() => registry.add("https://a.ts.net", paired("a"), "removed")).toThrow("no longer exists");
  });

  it("keeps local identity and data when a host is paired at a new address", () => {
    const registry = new ComputerRegistry(localStorage, "https://entry.ts.net");
    const a = registry.add("https://a.ts.net", paired("a"));
    registry.update(a.id, { name: "Work", lastRoute: "#/t/thread" });
    const changed = registry.add("https://renamed.ts.net", { ...paired("a"), token: "new-token" }, a.id);
    expect(changed).toMatchObject({ id: a.id, name: "Work", lastRoute: "#/t/thread", origin: "https://renamed.ts.net", token: "new-token" });
    expect(registry.store.get().computers).toHaveLength(1);
    expect(() => registry.add("https://b.ts.net", paired("b"), a.id)).toThrow("different computer");
  });

  it("isolates matching thread ids and file paths between computers", () => {
    const registry = new ComputerRegistry(localStorage, "https://entry.ts.net");
    const a = registry.add("https://a.ts.net", paired("a"));
    const b = registry.add("https://b.ts.net", paired("b"));
    saveDraft("same", { ...emptyDraft, text: "A", images: [{ id: "image", path: "/same/image.png", previewUrl: "" }] }, a.id);
    saveDraft("same", { ...emptyDraft, text: "B" }, b.id);
    setUnconfirmedSend("same", true, a.id);
    expect(hasUnconfirmedSend("same", a.id)).toBe(true);
    expect(hasUnconfirmedSend("same", b.id)).toBe(false);
    togglePin("same", a.id);
    setLastModel({ model: "only-a", effort: null }, a.id);
    saveThreadReadiness(new Map([["same", { unread: true, pending: false, since: 0, turnId: null }]]), a.id);
    expect(loadDraft("same", b.id)).toMatchObject({ text: "B", images: [] });
    expect(getPins(b.id)).toEqual([]);
    expect(getLastModel(b.id)).toBeNull();
    expect(loadThreadReadiness(b.id).size).toBe(0);
    registry.remove(a.id);
    expect(loadDraft("same", a.id).text).toBe("");
    expect(loadDraft("same", b.id).text).toBe("B");
    expect(registry.active!.id).toBe(b.id);
  });

  it("rejects credential-bearing URLs and endpoint paths", () => {
    expect(normalizeOrigin("https://mac.ts.net/#pair=CODE")).toBe("https://mac.ts.net");
    for (const url of ["https://user:pass@mac.ts.net", "javascript:alert(1)", "https://mac.ts.net/api/me", "https://mac.ts.net/?token=secret"]) expect(() => normalizeOrigin(url)).toThrow();
  });
});
