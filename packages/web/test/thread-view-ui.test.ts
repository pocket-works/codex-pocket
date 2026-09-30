// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/state/session.js";
import { createStore } from "../src/state/store.js";
import { initialThreadState } from "../src/state/thread-reducer.js";
import { ThreadView } from "../src/ui/ThreadView.js";

vi.mock("../src/ui/Composer.js", () => ({ Composer: () => createElement("textarea", { "aria-label": "Message" }) }));
vi.mock("../src/ui/ThreadMenu.js", () => ({ ThreadMenu: () => null }));
vi.mock("../src/ui/TurnView.js", () => ({ Transcript: () => null }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
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
    connection: "open", upstreamConnected: true, threads: [],
    open: { state: "ready", cwd: "/project", view: initialThreadState("thread-1"), olderCursor: null, loadingOlder: false, queue: [] },
  });
  const gitChanges = vi.fn().mockResolvedValue({
    diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
    branch: "main", upstream: "origin/main",
  });
  return { store, gitChanges, session: { store, gitChanges } as unknown as Session };
}

async function mount(session: Session) {
  await act(async () => root.render(createElement(StrictMode, null, createElement(ThreadView, { session }))));
  await act(async () => vi.advanceTimersByTimeAsync(350));
  expect(container.querySelectorAll(".changes-pill")).toHaveLength(1);
}

describe("single workspace changes entry", () => {
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
