import { describe, expect, it } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import type { RpcClient } from "../src/rpc/client.js";
import { RpcError } from "../src/rpc/client.js";
import { emptyDraft } from "../src/state/compose.js";
import { isDraft, Session } from "../src/state/session.js";
import { initialThreadState } from "../src/state/thread-reducer.js";

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
    session.store.set((s) => ({ ...s, threads: [{ id: "t1", cwd: "/proj", title: "old", preview: "old", updatedAt: 1, model: null, status: "idle", waitingFor: null, unread: false, branch: null }] }));
    await session.renameThread("t1", "  New name ");
    expect(calls).toEqual([{ method: "thread/name/set", params: { threadId: "t1", name: "New name" } }]);
    expect(session.store.get().threads[0].title).toBe("New name");
  });

  it("archives a thread, drops it from the list and closes it if open", async () => {
    const { rpc, calls } = stubRpc(() => ({}));
    const session = readySession(rpc, null);
    session.store.set((s) => ({ ...s, threads: [{ id: "t1", cwd: "/proj", title: "x", preview: "x", updatedAt: 1, model: null, status: "idle", waitingFor: null, unread: false, branch: null }] }));
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

  it("switches branches and surfaces git's error", async () => {
    const { rpc, calls } = stubRpc(() => ({ exitCode: 1, stdout: "", stderr: "error: Your local changes would be overwritten" }));
    await expect(new Session(rpc).gitSwitch("/proj", "feat/x")).rejects.toThrow(/local changes/);
    expect(calls[0].params).toMatchObject({ command: ["git", "switch", "feat/x"], cwd: "/proj" });
  });

  it("creates a worktree on a fresh codex/ branch under ~/.codex/worktrees", async () => {
    const { rpc, calls } = stubRpc(() => ({ exitCode: 0, stdout: "", stderr: "" }));
    const path = await new Session(rpc).gitWorktreeAdd("/Users/me/Projects/flow", "/Users/me", "main", "Fix the login bug");
    expect(path).toMatch(/^\/Users\/me\/\.codex\/worktrees\/[0-9a-f]{4}\/flow$/);
    expect(calls[0].params).toMatchObject({ command: ["git", "worktree", "add", "-b", "codex/fix-the-login-bug", path, "main"], cwd: "/Users/me/Projects/flow" });
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
  const resumed = { thread: { id: "t2" }, model: "m", cwd: "/proj", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null };

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

  it("still surfaces other history errors", async () => {
    const { rpc } = stubRpc((method) => (method === "thread/resume" ? resumed : new RpcError(-32000, "disk on fire")));
    const session = new Session(rpc);
    await session.openThread("t2");
    expect(session.store.get().open).toMatchObject({ state: "error", error: expect.stringContaining("disk on fire") });
  });
});
