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
  return { resolve, reject, send, finished, mount, clickSend };
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
