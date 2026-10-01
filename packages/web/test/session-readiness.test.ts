import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import type { ConnectionState, RpcClient } from "../src/rpc/client.js";
import { Session, type OpenThread } from "../src/state/session.js";
import { initialThreadState } from "../src/state/thread-reducer.js";
import { summarize } from "../src/state/thread-list.js";
import { loadThreadReadiness, saveThreadReadiness } from "../src/state/thread-readiness.js";
import { ThreadRow } from "../src/ui/ThreadList.js";

const memory = new Map<string, string>();
let visibility: string;
let events: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  memory.clear();
  visibility = "visible";
  events = new EventTarget();
  vi.stubGlobal("document", {
    get visibilityState() { return visibility; },
    addEventListener: events.addEventListener.bind(events),
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function thread(status: v2.ThreadStatus = { type: "idle" }): v2.Thread {
  return { id: "t1", cwd: "/project", name: "Work", preview: "Work", updatedAt: 1, status, model: "m", gitInfo: null } as v2.Thread;
}

function turn(status: v2.TurnStatus = "completed", id = "turn-1"): v2.Turn {
  return { id, status, completedAt: Math.floor(Date.now() / 1000), startedAt: null, durationMs: null, items: [], itemsView: "notLoaded", error: null };
}

function fixture() {
  let onState: (state: ConnectionState) => void = () => {};
  const response = { thread: thread(), turn: turn() };
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "thread/list") return { data: [response.thread], nextCursor: null };
    if (method === "thread/turns/list") return { data: [response.turn], nextCursor: null };
    if (method === "thread/items/list") return { data: [], nextCursor: null };
    if (method === "thread/resume") return {
      thread: response.thread, model: "m", cwd: "/project", reasoningEffort: null,
      approvalPolicy: "on-request", sandbox: { type: "readOnly" }, approvalsReviewer: "user", serviceTier: null,
    };
    if (method === "thread/queue/list") return { queuedMessages: [] };
    return {};
  });
  const rpc = {
    connectionState: "open", request, notify: vi.fn(), respond() {}, start() {},
    onNotification() {}, onServerRequest() {},
    onStateChange(listener: (state: ConnectionState) => void) { onState = listener; },
  } as unknown as RpcClient;
  const session = new Session(rpc);
  session.store.set((state) => ({ ...state, threads: [summarize(response.thread)] }));
  return { session, request, response, reconnect: () => onState("open") };
}

function open(session: Session, state: OpenThread["state"] = "ready") {
  session.store.set((current) => ({
    ...current,
    open: {
      view: initialThreadState("t1"), state, error: null, model: "m", effort: null, override: null,
      cwd: "/project", olderCursor: null, loadingOlder: false, queue: [], permissions: null,
      permissionOverride: null, serviceTier: null, serviceTierOverride: null,
    },
  }));
}

function complete(session: Session, status: v2.TurnStatus = "completed") {
  session.handleNotification({ method: "turn/completed", params: { threadId: "t1", turn: turn(status) } });
}

function status(session: Session, type: "active" | "idle" | "notLoaded") {
  session.handleNotification({ method: "thread/status/changed", params: { threadId: "t1", status: { type } } });
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

function unread(session: Session) {
  return session.store.get().threads.find((entry) => entry.id === "t1")?.unread;
}

describe("completed thread readiness", () => {
  it("shows the green Ready marker when a turn finishes in the list", () => {
    const { session } = fixture();
    complete(session);
    expect(unread(session)).toBe(true);
    const html = renderToStaticMarkup(createElement(ThreadRow, { thread: session.store.get().threads[0], onArchive() {} }));
    expect(html).toContain("thread-state ready");
    expect(html).toContain('aria-label="Ready"');
    expect(html).toContain('<span class="thread-state ready" role="status" aria-label="Ready" title="Ready"><span class="dot" aria-hidden="true"></span></span>');
  });

  it("treats a result already visible in the thread as read", () => {
    const { session } = fixture();
    open(session);
    complete(session);
    expect(unread(session)).toBe(false);
  });

  it.each(["loading", "error"] as const)("does not mark an unread result seen behind a %s screen", (state) => {
    const { session } = fixture();
    open(session, state);
    complete(session);
    expect(unread(session)).toBe(true);
  });

  it("keeps a completion unread when the open thread is in the background", async () => {
    const { session } = fixture();
    open(session);
    visibility = "hidden";
    complete(session);
    expect(unread(session)).toBe(true);
    await session.openThread("t1", { force: true });
    expect(unread(session)).toBe(true);
  });

  it("clears the marker after returning to the foreground and loading the result", async () => {
    const { session } = fixture();
    open(session);
    visibility = "hidden";
    complete(session);
    visibility = "visible";
    events.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(unread(session)).toBe(false);
  });

  it("preserves an unread completion across a full page reload", async () => {
    const first = fixture();
    complete(first.session);
    const second = new Session(first.session.rpc);
    await second.loadThreads();
    expect(unread(second)).toBe(true);
  });

  it("does not resurrect a read result on reload", async () => {
    const first = fixture();
    complete(first.session);
    await first.session.openThread("t1");
    const second = new Session(first.session.rpc);
    await second.loadThreads();
    expect(unread(second)).toBe(false);
  });

  it("clears a saved marker even when history loads before the first thread list", async () => {
    const first = fixture();
    complete(first.session);
    const second = new Session(first.session.rpc);
    await second.openThread("t1");
    await second.loadThreads();
    expect(unread(second)).toBe(false);
  });

  it.each(["idle", "notLoaded"] as const)("verifies a successful turn after a status-only transition to %s", async (type) => {
    const { session } = fixture();
    status(session, "active");
    status(session, type);
    await flush();
    expect(unread(session)).toBe(true);
  });

  it.each(["failed", "interrupted"] as const)("does not show green or a success toast for a %s turn", async (result) => {
    const { session, response } = fixture();
    response.turn = turn(result);
    status(session, "active");
    status(session, "idle");
    await flush();
    expect(unread(session)).toBe(false);
    complete(session, result);
    expect(session.store.get().toasts).toEqual([]);
  });

  it("recovers a completion missed while disconnected", async () => {
    const { session, reconnect } = fixture();
    status(session, "active");
    reconnect();
    await flush();
    expect(unread(session)).toBe(true);
  });

  it("recovers a running turn that completes during a full page reload", async () => {
    const first = fixture();
    status(first.session, "active");
    const second = new Session(first.session.rpc);
    await second.loadThreads();
    await flush();
    expect(unread(second)).toBe(true);
  });

  it("does not flag old completed turns on a first visit", async () => {
    const { session } = fixture();
    await session.loadThreads();
    await flush();
    expect(unread(session)).toBe(false);
  });

  it("does not flag an older turn while the active turn has not been persisted", async () => {
    const { session, response } = fixture();
    response.turn.completedAt = Math.floor(Date.now() / 1000) - 10;
    status(session, "active");
    status(session, "notLoaded");
    await flush();
    expect(unread(session)).toBe(false);
    expect(loadThreadReadiness().get("t1")?.pending).toBe(true);
  });

  it("rechecks an unfinished result on the next list refresh", async () => {
    const { session, response } = fixture();
    response.turn = turn("inProgress");
    status(session, "active");
    status(session, "idle");
    await flush();
    expect(unread(session)).toBe(false);
    response.turn = turn();
    await session.refreshPendingThreads();
    await flush();
    expect(unread(session)).toBe(true);
  });

  it("ignores a delayed completion check after a new turn starts", async () => {
    const { session, request } = fixture();
    let resolve: (value: unknown) => void = () => {};
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    status(session, "active");
    status(session, "idle");
    session.handleNotification({ method: "turn/started", params: { threadId: "t1", turn: turn("inProgress", "turn-2") } });
    resolve({ data: [turn()], nextCursor: null });
    await flush();
    expect(unread(session)).toBe(false);
    await session.refreshPendingThreads();
    await flush();
    expect(unread(session)).toBe(false);
  });

  it("matches a known turn ID when completion timestamps are unavailable", async () => {
    const { session, response } = fixture();
    session.handleNotification({ method: "turn/started", params: { threadId: "t1", turn: turn("inProgress") } });
    response.turn.completedAt = null;
    status(session, "idle");
    await flush();
    expect(unread(session)).toBe(true);
  });

  it("keeps uncertainty unflagged when neither a turn ID nor a completion timestamp is available", async () => {
    const { session, response } = fixture();
    response.turn.completedAt = null;
    status(session, "active");
    status(session, "idle");
    await flush();
    expect(unread(session)).toBe(false);
  });

  it("ignores a delayed check if a fresh list says the thread is running", async () => {
    const { session, request, response } = fixture();
    let resolve: (value: unknown) => void = () => {};
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    status(session, "active");
    status(session, "idle");
    response.thread = thread({ type: "active", activeFlags: [] });
    await session.loadThreads();
    resolve({ data: [turn()], nextCursor: null });
    await flush();
    expect(unread(session)).toBe(false);
  });

  it("does not reflag a result read while a completion check was in flight", async () => {
    const { session, request } = fixture();
    let resolve: (value: unknown) => void = () => {};
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    status(session, "active");
    status(session, "idle");
    await session.openThread("t1");
    await session.closeThread();
    resolve({ data: [turn()], nextCursor: null });
    await flush();
    expect(unread(session)).toBe(false);
    await session.refreshPendingThreads();
    await flush();
    expect(unread(session)).toBe(false);
  });

  it("removes saved markers when a thread is deleted", () => {
    const { session } = fixture();
    complete(session);
    session.handleNotification({ method: "thread/deleted", params: { threadId: "t1" } });
    expect(loadThreadReadiness().has("t1")).toBe(false);
  });
});

describe("readiness storage", () => {
  it("ignores malformed entries and invalid JSON", () => {
    memory.set("codex-pocket.threadReadiness", '{"bad":true}');
    expect(loadThreadReadiness().size).toBe(0);
    memory.set("codex-pocket.threadReadiness", "not json");
    expect(loadThreadReadiness().size).toBe(0);
    memory.set("codex-pocket.threadReadiness", '[["t1",null],["t2",{}]]');
    expect(loadThreadReadiness().size).toBe(0);
  });

  it("keeps the marker working when local storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    const { session } = fixture();
    complete(session);
    expect(unread(session)).toBe(true);
  });

  it("bounds saved metadata without storing messages or paths", () => {
    const entries = new Map(Array.from({ length: 510 }, (_, index) => [String(index), { unread: true, pending: false, since: 0, turnId: null }] as const));
    saveThreadReadiness(entries);
    expect(loadThreadReadiness().size).toBe(500);
    expect(loadThreadReadiness().has("0")).toBe(false);
    expect(loadThreadReadiness().has("509")).toBe(true);
  });
});
