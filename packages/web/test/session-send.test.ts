import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import type { RpcClient } from "../src/rpc/client.js";
import { RpcError } from "../src/rpc/client.js";
import { emptyDraft } from "../src/state/compose.js";
import { branchLabel, isDraft, scratchDateDir, scratchName, Session } from "../src/state/session.js";
import { initialThreadState } from "../src/state/thread-reducer.js";
import { getLastModel, setLastModel } from "../src/state/model-prefs.js";
import { summarize } from "../src/state/thread-list.js";

// The test environment is node; a Map is all the preference code needs.
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

// Just enough of RpcClient for Session: records requests, answers from a table.
function stubRpc(answer: (method: string, params: unknown) => unknown) {
  const calls: { method: string; params: unknown }[] = [];
  const notes: { method: string; params: unknown }[] = [];
  const rpc = {
    connectionState: "open",
    start() {},
    notify(method: string, params: unknown) {
      notes.push({ method, params });
    },
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
  return { rpc: rpc as unknown as RpcClient, calls, notes };
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
      queue: [],
      permissions: null,
      permissionOverride: null,
      serviceTier: null,
      serviceTierOverride: null,
    },
  }));
  return session;
}

describe("subagent threads", () => {
  const child = (id = "child", extra: Partial<v2.Thread> = {}): v2.Thread => ({
    id, parentThreadId: "t1", source: { subAgent: { thread_spawn: { parent_thread_id: "t1", depth: 1, agent_path: null, agent_nickname: "Audit", agent_role: "reviewer" } } },
    name: null, preview: "Audit the implementation", model: "m", cwd: "/proj", updatedAt: 1, status: { type: "idle" },
    canAcceptDirectInput: false, ...extra,
  }) as v2.Thread;

  it("pages through descendants and keeps both parent and unrelated chats", async () => {
    const { rpc, calls } = stubRpc((method, params) => {
      if (method === "thread/list") return (params as { cursor: string | null }).cursor === null
        ? { data: [child()], nextCursor: "next" }
        : { data: [child("nested", { parentThreadId: "child" })], nextCursor: null };
      return {};
    });
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [summarize(child("t1", { parentThreadId: null, source: "cli" })), summarize(child("other", { parentThreadId: null, source: "cli" }))] }));
    await Promise.all([session.loadSubagents("t1"), session.loadSubagents("t1")]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "thread/list", params: { ancestorThreadId: "t1", sourceKinds: ["subAgentThreadSpawn"], cursor: null } });
    expect(calls[1].params).toMatchObject({ cursor: "next" });
    expect(session.store.get().threads.map((thread) => thread.id).sort()).toEqual(["child", "nested", "other", "t1"]);
  });

  it("preserves children after refreshing the ordinary thread list", async () => {
    const { rpc } = stubRpc(() => ({ data: [child("t1", { parentThreadId: null, source: "cli" })], nextCursor: null }));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [summarize(child())] }));
    await session.loadThreads();
    expect(session.store.get().threads.map((thread) => thread.id).sort()).toEqual(["child", "t1"]);
  });

  it("opens the child with server input capability and does not load a follow-up queue", async () => {
    const { rpc, calls } = stubRpc((method) => {
      if (method === "thread/resume") return { thread: child(), model: "m", cwd: "/proj", reasoningEffort: null, sandbox: { type: "readOnly" } };
      return { data: [], nextCursor: null };
    });
    const session = readySession(rpc, null);
    await session.openThread("child");
    expect(session.store.get().open).toMatchObject({ state: "ready", parentThreadId: "t1", canAcceptDirectInput: false, agentNickname: "Audit" });
    expect(calls.some((call) => call.method === "thread/queue/list")).toBe(false);
  });

  it("reads the child transcript when resume rejects direct input", async () => {
    const { rpc } = stubRpc((method) => {
      if (method === "thread/resume") return new RpcError(-32600, "direct app-server input is not allowed for multi-agent v2 sub-agents");
      if (method === "thread/read") return { thread: child() };
      if (method === "thread/items/list") return { data: [{ turnId: "turn", item: { type: "agentMessage", id: "answer", text: "Audit complete", phase: "final_answer" } }], nextCursor: null };
      return { data: [], nextCursor: null };
    });
    const session = readySession(rpc, null);
    await session.openThread("child");
    expect(session.store.get().open).toMatchObject({ state: "ready", canAcceptDirectInput: false, parentThreadId: "t1" });
    expect(session.store.get().open?.view.items.map((item) => item.id)).toEqual(["answer"]);
  });

  it.each([null, "active"])("blocks direct sends, edits, retries and queued starts (%s)", async (activeTurnId) => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = readySession(rpc, activeTurnId);
    session.store.set((s) => ({ ...s, open: {
      ...s.open!, parentThreadId: "parent", canAcceptDirectInput: false,
      queue: [{ id: "q", text: "later", imageCount: 0, input: [] }],
      view: { ...s.open!.view, lastTurnError: "failed", items: [{ type: "userMessage", id: "u", clientId: null, content: [{ type: "text", text: "original", text_elements: [] }] }] },
    } }));
    await expect(session.sendMessage({ ...emptyDraft, text: "new" })).rejects.toThrow("parent thread");
    session.beginEdit("turn", "edit");
    await session.retryLastTurn();
    await session.sendQueuedNow("q");
    await session.resumeQueue();
    expect(calls).toEqual([]);
    expect(session.store.get().open?.editing).toBeUndefined();
    expect(session.store.get().open?.view.pending).toEqual([]);
  });

  it("does not auto-name or announce a completed child as an ordinary chat", () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [summarize(child())] }));
    session.handleNotification({ method: "turn/completed", params: { threadId: "child", turn: { id: "done", status: "completed", items: [] } } });
    expect(session.store.get().toasts).toEqual([]);
    expect(calls).toEqual([]);
  });
});

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

  it("queues on the server when the active turn cannot be steered", async () => {
    const { rpc, calls } = stubRpc((m, params) =>
      m === "turn/steer" ? new RpcError(-32000, "turn is not steerable") : { queuedSubmission: { id: "q1", input: (params as { input: unknown }).input, clientUserMessageId: "c" } },
    );
    const session = readySession(rpc, "active");
    await session.sendMessage({ ...emptyDraft, text: "later" });
    expect(calls.map((c) => c.method)).toEqual(["turn/steer", "thread/queue/add"]);
    expect(calls[1].params).toMatchObject({ threadId: "t1", input: [{ type: "text", text: "later" }] });
    expect(session.store.get().open?.queue).toEqual([{ id: "q1", text: "later", imageCount: 0, input: expect.any(Array) }]);
  });

  it("queues instead of steering when the follow-up mode is queue", async () => {
    const { rpc, calls } = stubRpc((_m, params) => ({ queuedSubmission: { id: "q1", input: (params as { input: unknown }).input, clientUserMessageId: "c" } }));
    const session = readySession(rpc, "active");
    session.setFollowUpMode("queue");
    await session.sendMessage({ ...emptyDraft, text: "later" });
    expect(calls.map((c) => c.method)).toEqual(["thread/queue/add"]);
  });

  it("starts a turn when idle even if the follow-up mode is queue", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "new" } }));
    const session = readySession(rpc, null);
    session.setFollowUpMode("queue");
    await session.sendMessage({ ...emptyDraft, text: "hi" });
    expect(calls.map((c) => c.method)).toEqual(["turn/start"]);
  });
});

describe("pending bubbles", () => {
  afterEach(() => void vi.useRealTimers());

  // Codex echoes a steered message only once the running tool call ends,
  // which can take far longer than the fallback timeout.
  it("keeps a steered message on screen until the running turn is over", async () => {
    vi.useFakeTimers();
    const { rpc } = stubRpc(() => ({ turnId: "active" }));
    const session = readySession(rpc, "active");
    session.setFollowUpMode("steer");
    await session.sendMessage({ ...emptyDraft, text: "also this" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.store.get().open?.view.pending).toHaveLength(1);

    session.store.set((s) => ({ ...s, open: s.open && { ...s.open, view: { ...s.open.view, activeTurnId: null } } }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.store.get().open?.view.pending).toEqual([]);
  });
});

describe("Session.retryLastTurn", () => {
  it("resends the failed turn's user message", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "again" } }));
    const session = readySession(rpc, null);
    const content: v2.UserInput[] = [{ type: "text", text: "do it", text_elements: [] }, { type: "localImage", path: "/p.png" }];
    session.store.set((s) => ({
      ...s,
      open: {
        ...s.open!,
        view: {
          ...s.open!.view,
          items: [
            { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "earlier", text_elements: [] }] },
            { type: "userMessage", id: "u2", clientId: null, content },
          ],
          itemTurns: { u1: "t-a", u2: "t-b" },
          lastTurnError: "model exploded",
        },
      },
    }));
    await session.retryLastTurn();
    expect(calls).toEqual([{ method: "turn/start", params: { threadId: "t1", input: content } }]);
    expect(session.store.get().open?.view.lastTurnError).toBeNull();
  });

  it("does nothing without a failed turn", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    await readySession(rpc, null).retryLastTurn();
    expect(calls).toEqual([]);
  });
});

describe("thread/settings/updated", () => {
  const settings = {
    cwd: "/proj",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "dangerFullAccess" },
    activePermissionProfile: null,
    model: "big",
    modelProvider: "openai",
    serviceTier: "priority",
    effort: "high",
    summary: null,
    collaborationMode: "default",
    personality: null,
  };

  it("adopts model, effort, permissions and tier changed from another client", () => {
    const { rpc } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    session.handleNotification({ method: "thread/settings/updated", params: { threadId: "t1", threadSettings: settings } });
    expect(session.store.get().open).toMatchObject({
      model: "big",
      effort: "high",
      serviceTier: "priority",
      permissions: { approval: "never", sandbox: "danger-full-access", reviewer: "user" },
    });
  });

  it("ignores settings of other threads", () => {
    const { rpc } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    session.handleNotification({ method: "thread/settings/updated", params: { threadId: "other", threadSettings: settings } });
    expect(session.store.get().open?.model).toBe("m");
  });
});

describe("server-side queue", () => {
  const sub = (id: string, text: string) => ({ id, clientUserMessageId: `c-${id}`, input: [{ type: "text", text, text_elements: [] }] });

  it("re-lists the queue when Codex reports a change on the open thread", async () => {
    const { rpc, calls } = stubRpc((m) => (m === "thread/queue/list" ? { data: [sub("q1", "one"), sub("q2", "two")], nextCursor: null } : {}));
    const session = readySession(rpc, "active");
    session.handleNotification({ method: "thread/queue/changed", params: { threadId: "t1" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([{ method: "thread/queue/list", params: { threadId: "t1", cursor: null } }]);
    expect(session.store.get().open?.queue.map((q) => q.text)).toEqual(["one", "two"]);
  });

  it("ignores queue changes on other threads", async () => {
    const { rpc, calls } = stubRpc(() => ({ data: [], nextCursor: null }));
    const session = readySession(rpc, "active");
    session.handleNotification({ method: "thread/queue/changed", params: { threadId: "other" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });

  it("deletes a queued message", async () => {
    const { rpc, calls } = stubRpc(() => ({ deleted: true }));
    const session = readySession(rpc, "active");
    session.store.set((s) => ({ ...s, open: { ...s.open!, queue: [{ id: "q1", text: "one", imageCount: 0, input: [] }] } }));
    await session.deleteQueued("q1");
    expect(calls).toEqual([{ method: "thread/queue/delete", params: { threadId: "t1", queuedSubmissionId: "q1" } }]);
    expect(session.store.get().open?.queue).toEqual([]);
  });

  it("sends a queued message now by steering the running turn, then removes it", async () => {
    const { rpc, calls } = stubRpc((m) => (m === "turn/steer" ? { turnId: "active" } : { deleted: true }));
    const session = readySession(rpc, "active");
    const input: v2.UserInput[] = [{ type: "text", text: "one", text_elements: [] }];
    session.store.set((s) => ({ ...s, open: { ...s.open!, queue: [{ id: "q1", text: "one", imageCount: 0, input }] } }));
    await session.sendQueuedNow("q1");
    expect(calls.map((c) => c.method)).toEqual(["turn/steer", "thread/queue/delete"]);
    expect(calls[0].params).toMatchObject({ threadId: "t1", expectedTurnId: "active", input });
    expect(session.store.get().open?.queue).toEqual([]);
  });

  it("starts a queued message directly when the thread is idle", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "n" } }));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, open: { ...s.open!, queue: [{ id: "q1", text: "one", imageCount: 0, input: [] }, { id: "q2", text: "two", imageCount: 0, input: [] }] } }));
    await session.resumeQueue();
    expect(calls).toEqual([{ method: "thread/queue/start", params: { threadId: "t1", queuedSubmissionId: "q1" } }]);
  });

  it("does nothing on resume while a turn runs", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = readySession(rpc, "active");
    session.store.set((s) => ({ ...s, open: { ...s.open!, queue: [{ id: "q1", text: "one", imageCount: 0, input: [] }] } }));
    await session.resumeQueue();
    expect(calls).toEqual([]);
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
    session.store.set((s) => ({ ...s, threads: [{ id: "t1", cwd: "/proj", projectId: null, title: "old", preview: "old", updatedAt: 1, model: null, status: "idle", waitingFor: null, unread: false, branch: null, named: false }] }));
    await session.renameThread("t1", "  New name ");
    expect(calls).toEqual([{ method: "thread/name/set", params: { threadId: "t1", name: "New name" } }]);
    expect(session.store.get().threads[0].title).toBe("New name");
  });

  it("archives a thread, drops it from the list and closes it if open", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [{ id: "t1", cwd: "/proj", projectId: null, title: "x", preview: "x", updatedAt: 1, model: null, status: "idle", waitingFor: null, unread: false, branch: null, named: false }] }));
    await session.archiveThread("t1");
    expect(calls.map((c) => c.method)).toEqual(["thread/archive", "thread/unsubscribe"]);
    expect(session.store.get().threads).toEqual([]);
    expect(session.store.get().open).toBeNull();
  });

  it("starts a review of uncommitted changes on the open thread", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "r" }, reviewThreadId: "t1" }));
    await readySession(rpc, null).startReview();
    expect(calls).toEqual([{ method: "review/start", params: { threadId: "t1", target: { type: "uncommittedChanges" }, delivery: "inline" } }]);
  });

  it("compacts the open thread's context when idle", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    await readySession(rpc, null).compactThread();
    expect(calls).toEqual([{ method: "thread/compact/start", params: { threadId: "t1" } }]);
  });

  it("refuses to compact while a turn runs", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    await expect(readySession(rpc, "active").compactThread()).rejects.toThrow(/in progress/);
    expect(calls).toEqual([]);
  });

  it("applies approval and sandbox overrides on the next turn", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "n" } }));
    const session = readySession(rpc, null);
    session.setPermissions("never", "workspace-write");
    await session.sendMessage({ ...emptyDraft, text: "go" });
    expect(calls[0].params).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "workspaceWrite" } });
    expect(session.store.get().open?.permissionOverride).toBeNull();
  });

  it("switches the service tier on the next turn and remembers it", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "n" } }));
    const session = readySession(rpc, null);
    session.setServiceTier("priority");
    expect(Session.isFast(session.store.get().open!)).toBe(true);
    await session.sendMessage({ ...emptyDraft, text: "go" });
    expect(calls[0].params).toMatchObject({ serviceTier: "priority" });
    expect(session.store.get().open).toMatchObject({ serviceTier: "priority", serviceTierOverride: null });
    // Back to standard: Codex wants an explicit "default".
    session.setServiceTier(null);
    expect(Session.isFast(session.store.get().open!)).toBe(false);
    await session.sendMessage({ ...emptyDraft, text: "go" });
    expect(calls[1].params).toMatchObject({ serviceTier: "default" });
    expect(session.store.get().open?.serviceTier).toBeNull();
  });

  // config.toml may set service_tier = "priority" globally; Codex drops it
  // with a warning on models that lack the tier. Send "default" instead so
  // the warning never fires and the UI does not claim Fast.
  it("falls back to the standard tier when the model does not offer the configured one", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "n" } }));
    const session = readySession(rpc, null);
    const tiers = (ids: string[]) => ids.map((id) => ({ id, name: id, description: "" }));
    session.store.set((s) => ({
      ...s,
      models: [
        { model: "m", serviceTiers: tiers(["priority"]) },
        { model: "deepseek-v4.1-flash", serviceTiers: [] },
      ] as unknown as v2.Model[],
      open: { ...s.open!, serviceTier: "priority" },
    }));
    // Still on "m", which has the tier: nothing to send.
    await session.sendMessage({ ...emptyDraft, text: "go" });
    expect(calls[0].params).not.toHaveProperty("serviceTier");
    expect(Session.isFast(session.store.get().open!)).toBe(true);

    session.setModel("deepseek-v4.1-flash", null);
    await session.sendMessage({ ...emptyDraft, text: "go" });
    expect(calls[1].params).toMatchObject({ model: "deepseek-v4.1-flash", serviceTier: "default" });
    expect(session.store.get().open).toMatchObject({ serviceTier: null, serviceTierOverride: null });
    expect(Session.isFast(session.store.get().open!)).toBe(false);
  });

  it("does not second-guess the tier before the model list has loaded", async () => {
    const { rpc, calls } = stubRpc(() => ({ turn: { id: "n" } }));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, open: { ...s.open!, serviceTier: "priority" } }));
    await session.sendMessage({ ...emptyDraft, text: "go" });
    expect(calls[0].params).not.toHaveProperty("serviceTier");
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

describe("draft thread (new-thread screen)", () => {
  const model = (m: string, isDefault: boolean) =>
    ({ id: m, model: m, displayName: m, isDefault, hidden: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [] }) as never;
  const started = (m: string, effort: string) => ({
    thread: { id: "t2" },
    model: m,
    reasoningEffort: effort,
    cwd: "/proj",
    approvalPolicy: "on-request",
    sandbox: { type: "workspaceWrite" },
    approvalsReviewer: "user",
    serviceTier: null,
  });

  beforeEach(() => localStorage.clear());

  it("opens a placeholder with the default model and keeps toolbar picks until thread/start", () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = new Session(rpc);
    session.store.set((s) => ({ ...s, models: [model("a", false), model("b", true)] }));
    session.openDraft("/proj");
    const open = session.store.get().open!;
    expect(isDraft(open)).toBe(true);
    expect(open.model).toBe("b");
    expect(open.cwd).toBe("/proj");
    session.setModel("a", null);
    session.setPermissionPreset("full");
    session.setServiceTier("priority");
    session.setDraftCwd("/other");
    const picked = session.store.get().open!;
    expect(picked.override).toEqual({ model: "a", effort: null });
    expect(picked.serviceTierOverride).toBe("priority");
    expect(picked.permissionOverride?.sandbox).toBe("danger-full-access");
    expect(picked.cwd).toBe("/other");
    expect(calls).toEqual([]);
  });

  it("fills in the default model once models load", async () => {
    const { rpc } = stubRpc((m) => (m === "model/list" ? { data: [model("x", true)] } : {}));
    const session = new Session(rpc);
    session.openDraft("/proj");
    expect(session.store.get().open!.model).toBe("");
    await session.loadModels();
    expect(session.store.get().open!.model).toBe("x");
  });

  it("starts a new draft from the model used last time, not Codex's default", async () => {
    setLastModel({ model: "a", effort: "high" });
    const { rpc } = stubRpc((m) => (m === "model/list" ? { data: [model("a", false), model("b", true)] } : {}));
    const session = new Session(rpc);
    session.openDraft("/proj");
    await session.loadModels();
    const open = session.store.get().open!;
    expect(open.model).toBe("b");
    expect(open.override).toEqual({ model: "a", effort: "high" });
  });

  it("falls back to the default when the remembered model is gone or is the default", () => {
    const { rpc } = stubRpc(() => ({}));
    setLastModel({ model: "retired", effort: "low" });
    const session = new Session(rpc);
    session.store.set((s) => ({ ...s, models: [model("b", true)] }));
    session.openDraft("/proj");
    expect(session.store.get().open!.override).toBeNull();
    setLastModel({ model: "b", effort: "medium" });
    session.openDraft("/proj");
    expect(session.store.get().open!.override).toBeNull();
  });

  it("remembers the model a thread starts with and the one a turn switches to", async () => {
    const { rpc } = stubRpc((m) => (m === "thread/start" ? started("a", "high") : {}));
    const session = new Session(rpc);
    await session.startThread("/proj", "a", null);
    expect(getLastModel()).toEqual({ model: "a", effort: "high" });
    session.setModel("c", "low");
    await session.sendMessage({ ...emptyDraft, text: "hi" });
    expect(getLastModel()).toEqual({ model: "c", effort: "low" });
  });

  it("does not carry a draft's pending pick into an existing thread", async () => {
    setLastModel({ model: "a", effort: "high" });
    const { rpc } = stubRpc((m) => (m === "thread/resume" ? new RpcError(-1, "boom") : {}));
    const session = new Session(rpc);
    session.store.set((s) => ({ ...s, models: [model("a", false), model("b", true)] }));
    session.openDraft("/proj");
    expect(session.store.get().open!.override).not.toBeNull();
    await session.openThread("t9");
    expect(session.store.get().open!.override).toBeNull();
  });

  it("does not unsubscribe a draft when closing it", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = new Session(rpc);
    session.openDraft("/proj");
    await session.closeThread();
    expect(calls).toEqual([]);
    expect(session.store.get().open).toBeNull();
  });
});

describe("git via command/exec", () => {
  it("reads the current branch and the local branch list", async () => {
    const { rpc, calls } = stubRpc((_m, params) => {
      const argv = (params as { command: string[] }).command.join(" ");
      if (argv.includes("rev-parse")) return { exitCode: 0, stdout: "main\n", stderr: "" };
      return { exitCode: 0, stdout: "feat/x\nmain\n", stderr: "" };
    });
    const info = await new Session(rpc).gitInfo("/proj");
    expect(info).toEqual({ branch: "main", branches: ["feat/x", "main"] });
    expect(calls.every((c) => c.method === "command/exec" && (c.params as { cwd: string }).cwd === "/proj")).toBe(true);
  });

  it("reports a non-repo as null", async () => {
    const { rpc } = stubRpc(() => ({ exitCode: 128, stdout: "", stderr: "fatal: not a git repository" }));
    expect(await new Session(rpc).gitInfo("/tmp")).toBeNull();
  });

  // Answers `git rev-parse --git-common-dir --git-dir`; everything else succeeds silently.
  const gitDirs = (commonDir: string, gitDir = commonDir) => (_m: string, params: unknown) => {
    const { command } = params as { command: string[] };
    return { exitCode: 0, stdout: command[1] === "rev-parse" ? `${commonDir}\n${gitDir}\n` : "", stderr: "" };
  };
  const exec = (calls: { params: unknown }[], sub: string) => calls.map((c) => c.params as { command: string[]; sandboxPolicy?: { writableRoots: string[] } }).find((p) => p.command[1] === sub)!;

  it("switches branches and surfaces git's error", async () => {
    const { rpc, calls } = stubRpc((_m, params) => {
      if ((params as { command: string[] }).command[1] === "rev-parse") return { exitCode: 0, stdout: "/proj/.git\n/proj/.git\n", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "error: Your local changes would be overwritten" };
    });
    await expect(new Session(rpc).gitSwitch("/proj", "feat/x")).rejects.toThrow(/local changes/);
    expect(exec(calls, "switch")).toMatchObject({ command: ["git", "switch", "feat/x"], cwd: "/proj" });
  });

  it("lets ref-writing commands into .git, which the workspace-write sandbox otherwise keeps read-only", async () => {
    const { rpc, calls } = stubRpc(gitDirs("/proj/.git"));
    await new Session(rpc).gitSwitch("/proj", "feat/x");
    const probe = exec(calls, "rev-parse");
    expect(probe.command).toEqual(["git", "rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"]);
    expect(probe.sandboxPolicy).toBeUndefined();
    expect(exec(calls, "switch").sandboxPolicy).toMatchObject({ type: "workspaceWrite", writableRoots: ["/proj", "/proj/.git"] });
  });

  it("opens both the shared and the private git dir when switching inside a linked worktree", async () => {
    const wt = "/Users/me/.codex/worktrees/1a2b/flow";
    const { rpc, calls } = stubRpc(gitDirs("/Users/me/Projects/flow/.git", "/Users/me/Projects/flow/.git/worktrees/flow"));
    await new Session(rpc).gitSwitch(wt, "main");
    expect(exec(calls, "switch").sandboxPolicy?.writableRoots).toEqual([wt, "/Users/me/Projects/flow/.git", "/Users/me/Projects/flow/.git/worktrees/flow"]);
  });

  it("creates a detached worktree under ~/.codex/worktrees, leaving the branch for later", async () => {
    const { rpc, calls } = stubRpc(gitDirs("/Users/me/Projects/flow/.git"));
    const path = await new Session(rpc).gitWorktreeAdd("/Users/me/Projects/flow", "/Users/me", "main");
    expect(path).toMatch(/^\/Users\/me\/\.codex\/worktrees\/[0-9a-f]{4}\/flow$/);
    expect(exec(calls, "worktree")).toMatchObject({
      command: ["git", "worktree", "add", "--detach", path, "main"],
      cwd: "/Users/me/Projects/flow",
      sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/Users/me/Projects/flow", "/Users/me/.codex/worktrees", "/Users/me/Projects/flow/.git"] },
    });
  });

  it("labels a detached checkout the way the desktop app does", () => {
    expect(branchLabel("HEAD")).toBe("Detached HEAD");
    expect(branchLabel("main")).toBe("main");
  });
});

describe("project-less chat folders", () => {
  it("names the folder after the prompt's first six words, like the desktop app", () => {
    expect(scratchName("Say hi in three words.")).toBe("say-hi-in-three-words");
    expect(scratchName("gcloud logging read 'resource.type=cloud_run_job' --limit 50")).toBe("gcloud-logging-read-resource-type-cloud");
    expect(scratchName("统计 Partner API 分类数量")).toBe("partner-api");
    expect(scratchName("今天星期几？")).toBe("new-chat");
    expect(scratchName("")).toBe("new-chat");
    expect(scratchName("x".repeat(100))).toHaveLength(80);
  });

  it("files the day by local time, not UTC", () => {
    const lateEvening = new Date(2026, 8, 20, 0, 5); // 2026-09-20 00:05 local
    expect(scratchDateDir("/Users/me/", lateEvening)).toBe("/Users/me/Documents/Codex/2026-09-20");
  });

  it("appends -2, -3, … until the folder does not exist yet", async () => {
    const taken = new Set(["/Users/me/Documents/Codex/2026-09-20/hi", "/Users/me/Documents/Codex/2026-09-20/hi-2"]);
    const { rpc, calls } = stubRpc((_m, params) => {
      const { path, recursive } = params as { path: string; recursive: boolean };
      return !recursive && taken.has(path) ? new Error("File exists (os error 17)") : {};
    });
    const dir = await new Session(rpc).createScratchDir("/Users/me", "hi", new Date(2026, 8, 20, 12));
    expect(dir).toBe("/Users/me/Documents/Codex/2026-09-20/hi-3");
    expect(calls.map((c) => c.params)).toEqual([
      { path: "/Users/me/Documents/Codex/2026-09-20", recursive: true },
      { path: "/Users/me/Documents/Codex/2026-09-20/hi", recursive: false },
      { path: "/Users/me/Documents/Codex/2026-09-20/hi-2", recursive: false },
      { path: "/Users/me/Documents/Codex/2026-09-20/hi-3", recursive: false },
    ]);
  });
});

describe("client state for push", () => {
  it("tells the host which thread is on screen whenever it changes", () => {
    const { rpc, notes } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    expect(notes.at(-1)).toEqual({ method: "pocket/client/state", params: { threadId: "t1", visible: true } });
    session.store.set((s) => ({ ...s, open: null }));
    expect(notes.at(-1)).toEqual({ method: "pocket/client/state", params: { threadId: null, visible: true } });
    expect(notes.length).toBe(2);
  });
});

describe("Session.openThread", () => {
  const resumed = { thread: { id: "t2", status: { type: "idle" } }, model: "m", cwd: "/proj", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null };

  it("falls back to thread/read while the first turn is not persisted yet", async () => {
    const { rpc } = stubRpc((method) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/items/list") return new RpcError(-32000, "thread/items/list is not supported yet");
      if (method === "thread/read") return { thread: { turns: [{ id: "u1", status: "inProgress", items: [{ id: "m1", type: "userMessage", content: [{ type: "text", text: "hi" }] }] }] } };
      return {};
    });
    const session = new Session(rpc);
    await session.openThread("t2");
    const open = session.store.get().open!;
    expect(open.state).toBe("ready");
    expect(open.view.items.map((i) => i.id)).toEqual(["m1"]);
    expect(open.view.itemTurns.m1).toBe("u1");
  });

  it("lists the server-side queue after resuming", async () => {
    const { rpc } = stubRpc((method) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/queue/list") return { data: [{ id: "q1", clientUserMessageId: "c", input: [{ type: "text", text: "next", text_elements: [] }] }], nextCursor: null };
      return { data: [], nextCursor: null };
    });
    const session = new Session(rpc);
    await session.openThread("t2");
    expect(session.store.get().open?.queue.map((q) => q.text)).toEqual(["next"]);
  });

  it("opens with an empty view when neither history call works", async () => {
    const { rpc } = stubRpc((method) => (method === "thread/resume" ? resumed : new RpcError(-32000, "thread/items/list is not supported yet")));
    const session = new Session(rpc);
    await session.openThread("t2");
    expect(session.store.get().open).toMatchObject({ state: "ready", cwd: "/proj" });
  });

  // Reloading the page or waking the phone mid-turn re-opens the thread, and
  // `turn/started` is long gone by then: without this the composer offers
  // Send instead of Stop while a command is still running.
  it("stays busy on the turn that is still running", async () => {
    const { rpc } = stubRpc((method) => {
      if (method === "thread/resume") return { ...resumed, thread: { id: "t2", status: { type: "active", activeFlags: [] } } };
      if (method === "thread/turns/list") {
        return { data: [{ id: "turn-2", status: "inProgress", startedAt: 200 }, { id: "turn-1", status: "completed", startedAt: 100 }], nextCursor: null };
      }
      return { data: [], nextCursor: null };
    });
    const session = new Session(rpc);
    await session.openThread("t2");
    expect(session.store.get().open?.view.activeTurnId).toBe("turn-2");
  });

  it("opens idle when the thread is not running a turn", async () => {
    const { rpc } = stubRpc((method) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/turns/list") return { data: [{ id: "turn-1", status: "inProgress", startedAt: 100 }], nextCursor: null };
      return { data: [], nextCursor: null };
    });
    const session = new Session(rpc);
    await session.openThread("t2");
    expect(session.store.get().open?.view.activeTurnId).toBeNull();
  });

  it("still surfaces other history errors", async () => {
    const { rpc } = stubRpc((method) => (method === "thread/resume" ? resumed : new RpcError(-32000, "disk on fire")));
    const session = new Session(rpc);
    await session.openThread("t2");
    expect(session.store.get().open).toMatchObject({ state: "error", error: expect.stringContaining("disk on fire") });
  });
});

describe("Session.sendMessage pending echo", () => {
  it("shows the message as pending until Codex echoes it, and clears it on failure", async () => {
    const { rpc } = stubRpc(() => ({ turn: { id: "new" } }));
    const session = readySession(rpc, null);
    const sent = session.sendMessage({ ...emptyDraft, text: "hi" });
    expect(session.store.get().open?.view.pending).toMatchObject([{ input: [{ type: "text", text: "hi" }] }]);
    await sent;
    expect(session.store.get().open?.view.pending).toHaveLength(1);
    session.handleNotification({ jsonrpc: "2.0", method: "item/started", params: { threadId: "t1", turnId: "new", item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "hi", text_elements: [] }] } } });
    expect(session.store.get().open?.view.pending).toHaveLength(0);

    const failing = readySession(stubRpc(() => new RpcError(-32000, "nope")).rpc, null);
    await expect(failing.sendMessage({ ...emptyDraft, text: "hi" })).rejects.toThrow("nope");
    expect(failing.store.get().open?.view.pending).toHaveLength(0);
  });

  it("retires the pending copy itself when the message went to the queue", async () => {
    const { rpc } = stubRpc((_m, params) => ({ queuedSubmission: { id: "q1", input: (params as { input: unknown }).input, clientUserMessageId: "c" } }));
    const session = readySession(rpc, "active");
    session.setFollowUpMode("queue");
    await session.sendMessage({ ...emptyDraft, text: "later" });
    expect(session.store.get().open?.view.pending).toHaveLength(0);
  });
});

describe("Session.forkThread", () => {
  it("forks through the given turn and opens the copy with its history", async () => {
    const { rpc, calls } = stubRpc((method, params) => {
      if (method === "thread/fork") return { thread: { id: "t2" }, model: "m", cwd: "/proj", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null };
      if (method === "thread/resume") return { thread: { id: (params as { threadId: string }).threadId }, model: "m", cwd: "/proj", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null };
      if (method === "thread/items/list") return { data: [{ turnId: "u1", item: { id: "m1", type: "userMessage", clientId: null, content: [{ type: "text", text: "hi", text_elements: [] }] } }], nextCursor: null };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      return {};
    });
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [{ id: "t1", title: "Weather" } as (typeof s.threads)[number]] }));
    const id = await session.forkThread("t1", "turn-1");
    expect(id).toBe("t2");
    expect(calls[0]).toEqual({ method: "thread/fork", params: { threadId: "t1", excludeTurns: true, lastTurnId: "turn-1" } });
    expect(calls).toContainEqual({ method: "thread/name/set", params: { threadId: "t2", name: "Fork of Weather" } });
    expect(calls.map((c) => c.method)).toContain("thread/resume");
    const open = session.store.get().open!;
    expect(open.view.threadId).toBe("t2");
    expect(open.state).toBe("ready");
    expect(open.view.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("names the fork after the source's first message when the list is not loaded", async () => {
    const { rpc, calls } = stubRpc((method) => {
      if (method === "thread/fork") return { thread: { id: "t2" }, model: "m", cwd: "/proj", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null };
      if (method === "thread/resume") return { thread: { id: "t2" }, model: "m", cwd: "/proj", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null };
      if (method === "thread/items/list" || method === "thread/turns/list") return { data: [], nextCursor: null };
      return {};
    });
    const session = readySession(rpc, null);
    session.store.set((s) => ({
      ...s,
      open: s.open && { ...s.open, view: { ...s.open.view, items: [{ type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "  What is the weather like today in Shanghai, and tomorrow?  ", text_elements: [] }] }] } },
    }));
    await session.forkThread("t1");
    expect(calls).toContainEqual({ method: "thread/name/set", params: { threadId: "t2", name: "Fork of What is the weather like today in Shangh…" } });
  });
});

describe("editing the last message", () => {
  it("reverts the thread before that turn, reloads, then starts the new turn", async () => {
    const { rpc, calls } = stubRpc((method) => {
      if (method === "thread/resume") return { thread: { id: "t1" }, model: "m", cwd: "/proj", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null };
      if (method === "thread/items/list" || method === "thread/turns/list" || method === "thread/queue/list") return { data: [], nextCursor: null };
      if (method === "thread/revert") return { thread: { id: "t1" }, turnsBackwardsCursor: null, itemsBackwardsCursor: null };
      return { turn: { id: "new" } };
    });
    const session = readySession(rpc, null);
    session.beginEdit("turn-9", "old text");
    expect(session.store.get().open?.editing).toEqual({ turnId: "turn-9", text: "old text" });
    await session.sendMessage({ ...emptyDraft, text: "new text" });
    const methods = calls.map((c) => c.method);
    expect(methods.indexOf("thread/revert")).toBeLessThan(methods.indexOf("turn/start"));
    expect(calls.find((c) => c.method === "thread/revert")?.params).toEqual({ threadId: "t1", beforeTurnId: "turn-9" });
    expect(calls.find((c) => c.method === "turn/start")?.params).toMatchObject({ input: [{ type: "text", text: "new text" }] });
    expect(session.store.get().open?.editing).toBeFalsy();
  });

  it("does not begin an edit while a turn is running", () => {
    const session = readySession(stubRpc(() => ({})).rpc, "active");
    session.beginEdit("turn-9", "x");
    expect(session.store.get().open?.editing).toBeUndefined();
  });
});
