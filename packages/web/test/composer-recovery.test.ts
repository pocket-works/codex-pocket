// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/ui/Composer.js";
import type { Session } from "../src/state/session.js";
import { createStore } from "../src/state/store.js";
import { emptyDraft } from "../src/state/compose.js";
import { hasUnconfirmedSend, loadDraft, saveDraft } from "../src/state/drafts.js";
import { CONNECTION_ERROR, RpcError } from "../src/rpc/client.js";

vi.mock("../src/ui/ComposerTools.js", () => ({
  ContextRing: () => null, DictationButton: () => null, EffortGauge: () => null,
  FastButton: () => null, PermissionsButton: () => null,
  useDictation: () => ({ phase: "idle", discard: () => {} }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function fixture() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const result = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  const send = vi.fn(() => result);
  const finished = vi.fn();
  const session = {
    host: { id: "a" },
    store: createStore({ open: { cwd: "/project", model: "model", effort: null, view: { threadId: "thread" } }, followUp: "steer", models: [], threads: [] }),
    beginOperation: () => finished,
  } as unknown as Session;
  saveDraft("new", { ...emptyDraft, text: "Do the work" }, "a");
  const mount = () => act(async () => root.render(createElement(Composer, { session, draftKey: "new", disabled: false, busy: false, onSend: send })));
  const clickSend = () => act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click());
  return { session, resolve, reject, send, finished, mount, clickSend };
}

describe("unconfirmed sends", () => {
  it("keeps the original draft during a send and clears it after success even after navigation", async () => {
    const test = fixture();
    await test.mount(); await test.clickSend();
    expect(loadDraft("new", "a").text).toBe("Do the work");
    expect(hasUnconfirmedSend("new", "a")).toBe(true);
    await act(async () => root.render(null));
    await act(async () => test.resolve());
    expect(loadDraft("new", "a").text).toBe("");
    expect(hasUnconfirmedSend("new", "a")).toBe(false);
    expect(test.finished).toHaveBeenCalledOnce();
  });

  it("restores an uncertain send after remount and requires acknowledgment before resending", async () => {
    const test = fixture();
    await test.mount(); await test.clickSend();
    await act(async () => test.reject(new RpcError(CONNECTION_ERROR, "request timed out")));
    await act(async () => root.render(null));
    await test.mount();
    expect(container.querySelector("textarea")!.value).toBe("Do the work");
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(true);
    expect(test.send).toHaveBeenCalledOnce();
    await act(async () => container.querySelector<HTMLButtonElement>(".composer-unconfirmed button")!.click());
    expect(hasUnconfirmedSend("new", "a")).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(false);
  });
});

describe("CSV attachments", () => {
  async function attachCsv() {
    const test = fixture();
    saveDraft("new", emptyDraft, "a");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: "/uploads/abc.csv" })));
    Object.assign(test.session.host!, { fetch });
    await test.mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toContain(".csv");
    const file = new File(["name,total\nAlice,42\n"], "sales.csv", { type: "application/vnd.ms-excel" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(fetch).toHaveBeenCalledWith("/api/uploads", expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "text/csv" }) }));
    expect(container.querySelector(".file-attachment-name")!.textContent).toBe("sales.csv");
    expect(container.querySelector(".thumb")).toBeNull();
    return test;
  }

  it("sends CSV-only messages and restores the file after a failed send", async () => {
    const test = await attachCsv();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(false);
    await test.clickSend();
    expect(test.send).toHaveBeenCalledWith(expect.objectContaining({ text: "", images: [], files: [expect.objectContaining({ name: "sales.csv", path: "/uploads/abc.csv" })] }));
    await act(async () => test.reject(new Error("send failed")));
    expect(container.querySelector(".file-attachment-name")!.textContent).toBe("sales.csv");
    expect(loadDraft("new", "a").files).toEqual([expect.objectContaining({ name: "sales.csv", path: "/uploads/abc.csv" })]);
  });

  it("removes a CSV attachment from the draft", async () => {
    await attachCsv();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove sales.csv"]')!.click());
    expect(container.querySelector(".file-attachment")).toBeNull();
    expect(loadDraft("new", "a").files).toEqual([]);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')).toBeNull();
  });
});
