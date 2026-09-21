import { describe, expect, it } from "vitest";
import type { ConnectionState, RpcClient } from "../src/rpc/client.js";
import { CONNECTION_ERROR, RpcError } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";
import { initialThreadState } from "../src/state/thread-reducer.js";

// The test environment is node; a Map is all the preference code needs.
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

// Just enough of RpcClient for Session: answers from a table and lets a test
// drive the connection state.
function stubRpc(answer: (method: string) => unknown) {
  const calls: string[] = [];
  let onState: (s: ConnectionState) => void = () => {};
  const rpc = {
    connectionState: "open",
    start() {},
    notify() {},
    request(method: string) {
      calls.push(method);
      const r = answer(method);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    respond() {},
    onStateChange(l: (s: ConnectionState) => void) {
      onState = l;
      return () => {};
    },
    onNotification() {
      return () => {};
    },
    onServerRequest() {
      return () => {};
    },
  };
  return { rpc: rpc as unknown as RpcClient, calls, setState: (s: ConnectionState) => onState(s) };
}

const dropped = () => new RpcError(CONNECTION_ERROR, "connection closed");

function withReadyThread(session: Session): Session {
  session.store.set((s) => ({
    ...s,
    open: {
      view: initialThreadState("t1"),
      state: "ready",
      error: null,
      model: "m",
      effort: null,
      override: null,
      cwd: "/proj",
      olderCursor: null,
      loadingOlder: false,
      queue: [],
      permissions: null,
      permissionOverride: null,
      serviceTier: null,
      serviceTierOverride: null,
    },
  }));
  return session;
}

describe("Session across a reconnect", () => {
  it("keeps a thread loading, not errored, when the socket drops mid-open", async () => {
    const session = new Session(stubRpc(dropped).rpc);
    await session.openThread("t1");
    expect(session.store.get().open).toMatchObject({ state: "loading", error: null });
  });

  it("still surfaces real errors from opening a thread", async () => {
    const session = new Session(stubRpc(() => new RpcError(-32000, "no such thread")).rpc);
    await session.openThread("t1");
    expect(session.store.get().open).toMatchObject({ state: "error", error: "no such thread" });
  });

  it("refreshes a ready thread in place instead of flipping it back to loading", async () => {
    let fail: (e: Error) => void = () => {};
    const { rpc } = stubRpc(() => new Promise((_, reject) => (fail = reject)));
    const session = withReadyThread(new Session(rpc));
    const done = session.openThread("t1", { force: true });
    expect(session.store.get().open?.state).toBe("ready");
    fail(new RpcError(-32000, "bail"));
    await done;
    expect(session.store.get().open?.state).toBe("error");
  });

  it("does not turn a dropped socket into a thread-list error", async () => {
    const session = new Session(stubRpc(dropped).rpc);
    await session.loadThreads();
    expect(session.store.get()).toMatchObject({ threadsLoading: false, threadsError: null });
  });

  it("keeps the last known Codex status while the socket is down", () => {
    const { rpc, setState } = stubRpc(() => ({}));
    const session = new Session(rpc);
    session.handleNotification({ jsonrpc: "2.0", method: "pocket/upstream/status", params: { connected: true } });
    setState("closed");
    expect(session.store.get()).toMatchObject({ connection: "closed", upstreamConnected: true });
  });
});

describe("turns finishing elsewhere", () => {
  const completed = (threadId: string) => ({ jsonrpc: "2.0" as const, method: "turn/completed", params: { threadId, turn: { id: "x", status: "completed" } } });

  it("raises a toast for a thread that is not on screen, naming it", () => {
    const session = withReadyThread(new Session(stubRpc(() => ({})).rpc));
    session.store.set((s) => ({ ...s, threads: [{ ...s.threads[0], id: "t2", title: "Other work" } as (typeof s.threads)[number]] }));
    session.handleNotification(completed("t2"));
    expect(session.store.get().toasts).toMatchObject([{ threadId: "t2", message: "Other work finished" }]);
  });

  it("stays quiet for the thread on screen", () => {
    const session = withReadyThread(new Session(stubRpc(() => ({})).rpc));
    session.handleNotification(completed("t1"));
    expect(session.store.get().toasts).toEqual([]);
  });
});

describe("archived threads", () => {
  it("shows an archived thread read-only instead of an error", async () => {
    const { rpc } = stubRpc((method) => {
      if (method === "thread/resume") return new RpcError(-32600, "session t1 is archived. Run `codex unarchive t1` to unarchive it first.");
      if (method === "thread/items/list") return { data: [{ turnId: "u1", item: { type: "userMessage", id: "m1", clientId: null, content: [{ type: "text", text: "old", text_elements: [] }] } }], nextCursor: null };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      return {};
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    expect(session.store.get().open).toMatchObject({ state: "archived", error: null });
    expect(session.store.get().open?.view.items.map((i) => i.id)).toEqual(["m1"]);
  });
});

describe("threads another process is writing to", () => {
  it("shows the transcript read-only behind the locked notice", async () => {
    const { rpc } = stubRpc((method) => {
      if (method === "thread/resume") return new RpcError(-32600, "thread t1 has an active writer in another process");
      if (method === "thread/items/list") return { data: [{ turnId: "u1", item: { type: "userMessage", id: "m1", clientId: null, content: [{ type: "text", text: "old", text_elements: [] }] } }], nextCursor: null };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      return {};
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    expect(session.store.get().open).toMatchObject({ state: "locked", error: null });
    expect(session.store.get().open?.view.items.map((i) => i.id)).toEqual(["m1"]);
  });
});
