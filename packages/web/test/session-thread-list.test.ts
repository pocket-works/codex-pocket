import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import type { RpcClient } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";
import { summarize } from "../src/state/thread-list.js";

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
});
afterEach(() => vi.unstubAllGlobals());

function thread(id: string, modelProvider = "openai"): v2.Thread {
  return {
    id, cwd: "/projects/data-report-flow", modelProvider, name: id, preview: id,
    updatedAt: 1, status: { type: "idle" }, model: "m", gitInfo: null,
  } as v2.Thread;
}

function fixture(answer: (params: v2.ThreadListParams) => Pick<v2.ThreadListResponse, "data" | "nextCursor">) {
  const request = vi.fn(async (method: string, params: v2.ThreadListParams) => {
    if (method !== "thread/list") throw new Error(`Unexpected method: ${method}`);
    return { backwardsCursor: null, ...answer(params) };
  });
  const rpc = {
    connectionState: "open", request,
    onStateChange() {}, onNotification() {}, onServerRequest() {},
  } as unknown as RpcClient;
  return { session: new Session(rpc), request };
}

describe("Session thread lists", () => {
  it("includes every provider and page, deduplicates overlaps, and keeps unread state", async () => {
    const { session, request } = fixture((params) => {
      // Mirrors the server: omission hides custom-provider sessions.
      expect(params.modelProviders).toEqual([]);
      if (!params.cursor) return { data: [thread("today", "sub2api")], nextCursor: "older" };
      if (params.cursor === "older") return { data: [thread("today", "sub2api"), thread("older")], nextCursor: "oldest" };
      return { data: [thread("oldest")], nextCursor: null };
    });
    session.store.set((s) => ({ ...s, threads: [summarize(thread("older"), true), summarize(thread("removed"))] }));

    await session.loadThreads();

    expect(session.store.get().threads.map((t) => t.id)).toEqual(["today", "older", "oldest"]);
    expect(session.store.get().threads.find((t) => t.id === "older")?.unread).toBe(true);
    expect(session.store.get()).toMatchObject({ threadsLoading: false, threadsError: null });
    expect(request.mock.calls.map(([, params]) => params.cursor)).toEqual([null, "older", "oldest"]);
    expect(request.mock.calls.every(([, params]) => params.sourceKinds === undefined)).toBe(true);
  });

  it("keeps the previous list and reports an error if a later page fails", async () => {
    const { session } = fixture((params) => {
      if (params.cursor) throw new Error("Page unavailable");
      return { data: [thread("new")], nextCursor: "older" };
    });
    const previous = [summarize(thread("known"), true)];
    session.store.set((s) => ({ ...s, threads: previous }));

    await session.loadThreads();

    expect(session.store.get().threads).toEqual(previous);
    expect(session.store.get()).toMatchObject({ threadsLoading: false, threadsError: "Page unavailable" });
  });

  it("stops if the server repeats a cursor", async () => {
    const { session, request } = fixture(() => ({ data: [], nextCursor: "same" }));
    await session.loadThreads();
    expect(request).toHaveBeenCalledTimes(2);
    expect(session.store.get()).toMatchObject({ threadsLoading: false, threadsError: "Thread pagination cursor did not advance" });
  });

  it("loads archived threads across all providers and pages without changing the active list", async () => {
    const { session, request } = fixture((params) => {
      expect(params).toMatchObject({ archived: true, modelProviders: [] });
      return params.cursor
        ? { data: [thread("older")], nextCursor: null }
        : { data: [thread("custom", "sub2api")], nextCursor: "older" };
    });
    const previous = [summarize(thread("active"))];
    session.store.set((s) => ({ ...s, threads: previous }));

    expect((await session.loadArchivedThreads()).map((t) => t.id)).toEqual(["custom", "older"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(session.store.get().threads).toEqual(previous);
  });
});
