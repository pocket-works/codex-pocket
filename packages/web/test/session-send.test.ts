import { describe, expect, it } from "vitest";
import type { RpcClient } from "../src/rpc/client.js";
import { RpcError } from "../src/rpc/client.js";
import { emptyDraft } from "../src/state/compose.js";
import { Session } from "../src/state/session.js";
import { initialThreadState } from "../src/state/thread-reducer.js";

// Just enough of RpcClient for Session: records requests, answers from a table.
function stubRpc(answer: (method: string, params: unknown) => unknown) {
  const calls: { method: string; params: unknown }[] = [];
  const rpc = {
    connectionState: "open",
    start() {},
    request(method: string, params: unknown) {
      calls.push({ method, params });
      const r = answer(method, params);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    respond() {},
    onStateChange() {
      return () => {};
    },
    onNotification() {
      return () => {};
    },
    onServerRequest() {
      return () => {};
    },
  };
  return { rpc: rpc as unknown as RpcClient, calls };
}

function readySession(rpc: RpcClient, activeTurnId: string | null): Session {
  const session = new Session(rpc);
  session.store.set((s) => ({
    ...s,
    open: {
      view: { ...initialThreadState("t1"), activeTurnId },
      state: "ready",
      error: null,
      model: "m",
      effort: null,
      override: null,
      cwd: "/proj",
      olderCursor: null,
      loadingOlder: false,
      queued: [],
      permissions: null,
      permissionOverride: null,
    },
  }));
  return session;
}

describe("Session.sendMessage", () => {
  it("starts a turn when the thread is idle", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "new" } }));
    await readySession(rpc, null).sendMessage({ ...emptyDraft, text: "hi" });
    expect(calls).toEqual([{ method: "turn/start", params: { threadId: "t1", input: [{ type: "text", text: "hi", text_elements: [] }] } }]);
  });

  it("steers the active turn instead of starting a new one", async () => {
    const { rpc, calls } = stubRpc(() => ({ turnId: "active" }));
    await readySession(rpc, "active").sendMessage({ ...emptyDraft, text: "also this" });
    expect(calls.map((c) => c.method)).toEqual(["turn/steer"]);
    expect(calls[0].params).toMatchObject({ threadId: "t1", expectedTurnId: "active" });
  });

  it("falls back to queueing a turn when the active turn cannot be steered", async () => {
    const { rpc, calls } = stubRpc((m) => (m === "turn/steer" ? new RpcError(-32000, "turn is not steerable") : { turn: { id: "q" } }));
    const session = readySession(rpc, "active");
    await session.sendMessage({ ...emptyDraft, text: "later" });
    expect(calls.map((c) => c.method)).toEqual(["turn/steer", "turn/start"]);
    expect(session.store.get().open?.queued).toEqual(["later"]);
  });

  it("clears locally queued messages once the next turn starts", async () => {
    const { rpc } = stubRpc((m) => (m === "turn/steer" ? new RpcError(-32000, "no") : { turn: { id: "q" } }));
    const session = readySession(rpc, "active");
    await session.sendMessage({ ...emptyDraft, text: "later" });
    session.handleNotification({ method: "turn/started", params: { threadId: "t1", turn: { id: "q" } } });
    expect(session.store.get().open?.queued).toEqual([]);
  });
});

describe("Session.searchFiles", () => {
  it("searches under the open thread's cwd and drops stale results", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const { rpc, calls } = stubRpc(() => ({ files: [{ root: "/proj", path: "src/a.ts", file_name: "a.ts", score: 1, match_type: "fuzzy", indices: null }] }));
    // First call hangs until we release it, second resolves immediately.
    let n = 0;
    (rpc as unknown as { request: unknown }).request = (method: string, params: unknown) => {
      calls.push({ method, params });
      if (n++ === 0) return new Promise((r) => (resolveFirst = r));
      return Promise.resolve({ files: [{ root: "/proj", path: "src/b.ts", file_name: "b.ts", score: 1, match_type: "fuzzy", indices: null }] });
    };
    const session = readySession(rpc, null);
    const first = session.searchFiles("a");
    const second = session.searchFiles("b");
    resolveFirst({ files: [{ root: "/proj", path: "src/a.ts", file_name: "a.ts", score: 1, match_type: "fuzzy", indices: null }] });
    expect(await second).toEqual([{ name: "b.ts", path: "/proj/src/b.ts", relative: "src/b.ts" }]);
    expect(await first).toEqual([]);
    expect(calls[0].params).toMatchObject({ query: "a", roots: ["/proj"] });
  });
});

describe("thread management", () => {
  it("renames the open thread and updates the list optimistically", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [{ id: "t1", cwd: "/proj", title: "old", preview: "old", updatedAt: 1, model: null, status: "idle", branch: null }] }));
    await session.renameThread("t1", "  New name ");
    expect(calls).toEqual([{ method: "thread/name/set", params: { threadId: "t1", name: "New name" } }]);
    expect(session.store.get().threads[0].title).toBe("New name");
  });

  it("archives a thread, drops it from the list and closes it if open", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [{ id: "t1", cwd: "/proj", title: "x", preview: "x", updatedAt: 1, model: null, status: "idle", branch: null }] }));
    await session.archiveThread("t1");
    expect(calls.map((c) => c.method)).toEqual(["thread/archive", "thread/unsubscribe"]);
    expect(session.store.get().threads).toEqual([]);
    expect(session.store.get().open).toBeNull();
  });

  it("forks the open thread and opens the copy", async () => {
    const { rpc, calls } = stubRpc(() => ({ thread: { id: "t2" }, model: "m", reasoningEffort: null, cwd: "/proj", approvalPolicy: "on-request", sandbox: { type: "readOnly", networkAccess: false } }));
    const session = readySession(rpc, null);
    const id = await session.forkThread("t1");
    expect(id).toBe("t2");
    expect(calls[0]).toEqual({ method: "thread/fork", params: { threadId: "t1" } });
    expect(session.store.get().open?.view.threadId).toBe("t2");
  });

  it("starts a review of uncommitted changes on the open thread", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "r" }, reviewThreadId: "t1" }));
    await readySession(rpc, null).startReview();
    expect(calls).toEqual([{ method: "review/start", params: { threadId: "t1", target: { type: "uncommittedChanges" }, delivery: "inline" } }]);
  });

  it("applies approval and sandbox overrides on the next turn", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "n" } }));
    const session = readySession(rpc, null);
    session.setPermissions("never", "workspace-write");
    await session.sendMessage({ ...emptyDraft, text: "go" });
    expect(calls[0].params).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "workspaceWrite" } });
    expect(session.store.get().open?.permissionOverride).toBeNull();
  });
});

describe("Session.listDirectory", () => {
  it("returns child directories sorted, hiding dotfiles", async () => {
    const { rpc } = stubRpc(() => ({
      entries: [
        { fileName: "zeta", isDirectory: true, isFile: false },
        { fileName: ".git", isDirectory: true, isFile: false },
        { fileName: "README.md", isDirectory: false, isFile: true },
        { fileName: "alpha", isDirectory: true, isFile: false },
      ],
    }));
    expect(await readySession(rpc, null).listDirectory("/proj")).toEqual(["alpha", "zeta"]);
  });
});
