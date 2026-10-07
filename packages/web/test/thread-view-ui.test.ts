// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenThread, Session, ThreadSummary } from "../src/state/session.js";
import { createStore } from "../src/state/store.js";
import { initialThreadState } from "../src/state/thread-reducer.js";
import { ThreadView } from "../src/ui/ThreadView.js";
import { ThreadList } from "../src/ui/ThreadList.js";
import { parseRoute } from "../src/ui/route.js";

vi.mock("../src/ui/Composer.js", () => ({ Composer: () => createElement("textarea", { "aria-label": "Message" }) }));
vi.mock("../src/ui/ThreadMenu.js", () => ({ ThreadMenu: () => null }));
vi.mock("../src/ui/TurnView.js", () => ({ Transcript: () => null }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/#/t/thread-1");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const store = createStore({
    connection: "open", upstreamConnected: true, threads: [] as ThreadSummary[],
    projects: [], threadsLoading: false, threadsError: null, rateLimits: null,
    open: { state: "ready", cwd: "/project", view: initialThreadState("thread-1"), olderCursor: null, loadingOlder: false, queue: [], parentThreadId: null, canAcceptDirectInput: true, error: null, model: "gpt-5", effort: null, override: null, permissions: null, permissionOverride: null, serviceTier: null, serviceTierOverride: null } as OpenThread,
  });
  const gitChanges = vi.fn().mockResolvedValue({
    diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
    branch: "main", upstream: "origin/main",
  });
  const loadSubagents = vi.fn().mockResolvedValue(undefined);
  return { store, gitChanges, loadSubagents, session: { store, gitChanges, loadSubagents, loadThreads: vi.fn(), loadProjects: vi.fn(), refreshPendingThreads: vi.fn() } as unknown as Session };
}

function agent(id: string, status: ThreadSummary["status"], parentThreadId: string | null = "thread-1"): ThreadSummary {
  return { id, status, parentThreadId, isSubagent: parentThreadId !== null, agentNickname: id, title: id, preview: "Inspect changes", updatedAt: Date.now(), cwd: "/project", model: "gpt-5", projectId: null, waitingFor: status === "waiting" ? "approval" : null, unread: false, branch: null, named: true };
}

async function click(selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector)!;
  expect(button).not.toBeNull();
  await act(async () => {
    button.click();
    window.dispatchEvent(new Event("hashchange"));
  });
}

async function mount(session: Session) {
  await act(async () => root.render(createElement(StrictMode, null, createElement(ThreadView, { session }))));
  await act(async () => vi.advanceTimersByTimeAsync(350));
  expect(container.querySelectorAll(".changes-pill")).toHaveLength(1);
}

describe("single workspace changes entry", () => {
  it("anchors the visible content when background history is prepended", async () => {
    const { session, store } = fixture();
    await mount(session);
    const items = container.querySelector<HTMLDivElement>(".items")!;
    const message = (id: string): OpenThread["view"]["items"][number] => ({ type: "userMessage", id, clientId: null, content: [] });
    let height = 1000;
    Object.defineProperties(items, { scrollHeight: { get: () => height }, clientHeight: { value: 600 } });
    await act(async () => store.set((s) => ({ ...s, open: { ...s.open, view: { ...s.open.view, items: [message("newest")] } } })));
    await act(async () => {
      items.scrollTop = 150;
      items.dispatchEvent(new Event("scroll"));
    });
    height = 1400;
    // Browsers may anchor the scroll position during the DOM update too.
    items.scrollTop = 550;
    await act(async () => store.set((s) => ({ ...s, open: { ...s.open, view: { ...s.open.view, items: [message("older"), ...s.open.view.items] } } })));
    expect(items.scrollTop).toBe(550);
    await act(async () => store.set((s) => ({ ...s, open: { ...s.open, view: { ...s.open.view, items: [...s.open.view.items, message("live")] } } })));
    expect(items.scrollTop).toBe(550);

    await act(async () => {
      items.scrollTop = 800;
      items.dispatchEvent(new Event("scroll"));
    });
    height = 1800;
    await act(async () => store.set((s) => ({ ...s, open: { ...s.open, view: { ...s.open.view, items: [message("oldest"), ...s.open.view.items] } } })));
    expect(items.scrollTop).toBe(1800);
  });

  it("opens the next thread at the bottom after reading older history", async () => {
    const { session, store } = fixture();
    await mount(session);
    const items = container.querySelector<HTMLDivElement>(".items")!;
    Object.defineProperties(items, { scrollHeight: { value: 2000 }, clientHeight: { value: 600 } });
    await act(async () => {
      items.scrollTop = 400;
      items.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector(".scroll-bottom-btn")).not.toBeNull();
    await act(async () => store.set((s) => ({ ...s, open: { ...s.open, view: initialThreadState("thread-2") } })));
    expect(items.scrollTop).toBe(2000);
    expect(container.querySelector(".scroll-bottom-btn")).toBeNull();
  });

  it("loads buffered history on an upward scroll after the server cursor is exhausted", async () => {
    const { session, store } = fixture();
    const loadOlder = vi.fn().mockResolvedValue(undefined);
    session.loadOlder = loadOlder;
    await mount(session);
    const items = container.querySelector<HTMLDivElement>(".items")!;
    Object.defineProperties(items, { scrollHeight: { value: 2000 }, clientHeight: { value: 600 } });
    await act(async () => store.set((s) => ({ ...s, open: { ...s.open, olderEntries: [{ turnId: "old", item: { type: "userMessage", id: "old-u", clientId: null, content: [] } }] } })));
    expect(loadOlder).not.toHaveBeenCalled();
    await act(async () => {
      items.scrollTop = 0;
      items.dispatchEvent(new Event("scroll"));
    });
    expect(loadOlder).toHaveBeenCalledOnce();
  });

  it("does not leave a duplicate when the scroll-to-bottom button appears and disappears", async () => {
    const { session } = fixture();
    await mount(session);
    const items = container.querySelector<HTMLDivElement>(".items")!;
    Object.defineProperties(items, { scrollHeight: { value: 2000 }, clientHeight: { value: 600 } });
    for (const scrollTop of [400, 1400, 400, 1400]) {
      await act(async () => {
        items.scrollTop = scrollTop;
        items.dispatchEvent(new Event("scroll"));
      });
      expect(container.querySelectorAll(".changes-pill")).toHaveLength(1);
      expect(container.querySelectorAll("textarea")).toHaveLength(1);
    }
  });

  it("does not leave an old entry when switching between threads", async () => {
    const { session, store } = fixture();
    await mount(session);
    for (const threadId of ["thread-2", "thread-1", "thread-3"]) {
      await act(async () => store.set((state) => ({ ...state, open: { ...state.open, view: initialThreadState(threadId) } })));
      await act(async () => vi.advanceTimersByTimeAsync(350));
      expect(container.querySelectorAll(".changes-pill")).toHaveLength(1);
      expect(container.querySelectorAll("textarea")).toHaveLength(1);
    }
  });

  it("keeps one entry across refreshes and removes it when the workspace becomes clean", async () => {
    const { session, gitChanges } = fixture();
    await mount(session);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(container.querySelectorAll(".changes-pill")).toHaveLength(1);
    gitChanges.mockResolvedValue({ diff: "", branch: "main", upstream: "origin/main" });
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(container.querySelectorAll(".changes-pill")).toHaveLength(0);
  });
});

describe("subagent navigation", () => {
  it.each(["loaded", "failed"])("hides the entry when there are no children and loading %s", async (result) => {
    const { session, loadSubagents } = fixture();
    if (result === "failed") loadSubagents.mockRejectedValue(new Error("Unavailable"));
    await mount(session);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(container.querySelector(".subagents-entry")).toBeNull();
    expect(container.querySelectorAll(".changes-pill")).toHaveLength(1);
  });

  it("removes the entry when the parent no longer has children", async () => {
    const { session, store } = fixture();
    store.set((s) => ({ ...s, threads: [agent("Audit", "idle")] }));
    await mount(session);
    expect(container.querySelector(".subagents-entry")).not.toBeNull();
    await act(async () => store.set((s) => ({ ...s, threads: [] })));
    expect(container.querySelector(".subagents-entry")).toBeNull();
    expect(container.querySelectorAll(".changes-pill")).toHaveLength(1);
  });

  it("hides subagents from the ordinary chat list", async () => {
    const { session, store } = fixture();
    store.set((s) => ({ ...s, threads: [agent("Parent chat", "idle", null), agent("Hidden child", "running")] }));
    await act(async () => root.render(createElement(ThreadList, { session })));
    expect(container.textContent).toContain("Parent chat");
    expect(container.textContent).not.toContain("Hidden child");
  });

  it("opens grouped statuses from the parent footer and navigates to a child", async () => {
    const { session, store } = fixture();
    store.set((s) => ({ ...s, threads: [agent("Audit", "running"), agent("Approval", "waiting"), agent("Tests", "idle"), agent("Unrelated", "running", "other")] }));
    await mount(session);
    const entry = container.querySelector(".subagents-entry")!;
    expect(entry.getAttribute("title")).toContain("1 working · 1 waiting · 1 done");
    expect(entry.querySelector(".subagents-entry-status")?.textContent).toBe("1 waiting");
    expect(entry.parentElement).toBe(container.querySelector(".changes-pill")?.parentElement);
    expect(entry.parentElement?.className).toBe("thread-context-row");
    await click('[aria-label="Open subagents"]');
    const sheet = container.querySelector('[role="dialog"][aria-label="Subagents"]');
    expect(sheet?.textContent).toContain("Active · 2");
    expect(sheet?.textContent).toContain("Done · 1");
    expect(sheet?.textContent).not.toContain("Unrelated");
    expect(document.activeElement).toBe(sheet);
    await click(".subagent-row");
    expect(parseRoute(location.hash)).toEqual({ name: "thread", id: "Audit" });
  });

  it("keeps a child read-only and offers both parent return paths", async () => {
    const { session, store } = fixture();
    history.replaceState(null, "", "/#/t/Audit");
    store.set((s) => ({ ...s, open: { ...s.open, parentThreadId: "thread-1", canAcceptDirectInput: false, agentNickname: "Audit", queue: [{ id: "q1", text: "Queued", imageCount: 0, input: [] }], view: { ...initialThreadState("Audit"), lastTurnError: "Failed" } } }));
    await mount(session);
    expect(container.querySelector("h1")?.textContent).toBe("Audit");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector(".queued-list")).toBeNull();
    expect(container.querySelector(".turn-error button")).toBeNull();
    expect(container.querySelector(".subagent-footer")?.textContent).toContain("Read-only");
    await click('[aria-label="Back to subagents"]');
    expect(parseRoute(location.hash)).toEqual({ name: "thread", id: "thread-1", subagents: true });
    await click(".subagent-footer button");
    expect(parseRoute(location.hash)).toEqual({ name: "thread", id: "thread-1" });
  });

  it("restores the panel from its URL and retries a failed load", async () => {
    const { session, loadSubagents } = fixture();
    history.replaceState(null, "", "/#/t/thread-1?subagents=1");
    loadSubagents.mockRejectedValue(new Error("Temporary failure"));
    await mount(session);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Temporary failure");
    loadSubagents.mockResolvedValue(undefined);
    await click(".subagents-error button");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".subagents-sheet")?.textContent).toContain("No subagents.");
    await click('[aria-label="Close subagents"]');
    expect(container.querySelector(".subagents-sheet")).toBeNull();
    expect(parseRoute(location.hash)).toEqual({ name: "thread", id: "thread-1" });
  });
});
