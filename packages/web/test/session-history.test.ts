import { describe, expect, it, vi } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import { RpcError, type RpcClient } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";

// The test environment is node; a Map is all the preference code needs.
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

function stubRpc(answer: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const rpc = {
    connectionState: "open",
    start() {},
    notify() {},
    request(method: string, params: Record<string, unknown>) {
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

const resumed = {
  thread: { id: "t1", status: { type: "idle" } },
  model: "m",
  reasoningEffort: null,
  cwd: "/proj",
  approvalPolicy: "onRequest",
  sandbox: { mode: "workspaceWrite" },
  approvalsReviewer: null,
  serviceTier: null,
};

function userMessage(id: string, turnId: string): v2.ThreadItemEntry {
  return { turnId, item: { type: "userMessage", id, content: [{ type: "text", text: id }] } } as unknown as v2.ThreadItemEntry;
}

function command(id: string, turnId: string): v2.ThreadItemEntry {
  return { turnId, item: { type: "commandExecution", id, command: "ls", aggregatedOutput: "", status: "completed", exitCode: 0, commandActions: null } } as unknown as v2.ThreadItemEntry;
}

function answer(id: string, turnId: string): v2.ThreadItemEntry {
  return { turnId, item: { type: "agentMessage", id, text: "A long answer. ".repeat(200), phase: "final_answer" } } as v2.ThreadItemEntry;
}

/** Pages of history, newest page first, each page oldest item first. */
function historyRpc(pages: v2.ThreadItemEntry[][]) {
  return stubRpc((method, params) => {
    if (method === "thread/resume") return resumed;
    if (method === "thread/turns/list") return { data: [], nextCursor: null };
    if (method === "thread/queue/list") return { queue: [] };
    if (method === "thread/items/list") {
      const index = params.cursor === undefined || params.cursor === null ? 0 : Number(params.cursor);
      return { data: pages[index].slice().reverse(), nextCursor: index + 1 < pages.length ? String(index + 1) : null };
    }
    return {};
  });
}

function conversation(count: number, tools = 0): v2.ThreadItemEntry[] {
  return Array.from({ length: count }, (_, i) => [
    userMessage(`u${i}`, `turn${i}`),
    ...Array.from({ length: tools }, (_, j) => command(`c${i}-${j}`, `turn${i}`)),
    answer(`a${i}`, `turn${i}`),
  ]).flat();
}

function userIds(session: Session): string[] {
  return session.store.get().open!.view.items.filter((item) => item.type === "userMessage").map((item) => item.id);
}

function paginatedHistoryRpc(entries: v2.ThreadItemEntry[], resumeError?: Error) {
  return stubRpc((method, params) => {
    if (method === "thread/resume") return resumeError ?? resumed;
    if (method === "thread/turns/list") return { data: [], nextCursor: null };
    if (method === "thread/queue/list") return { queue: [] };
    if (method === "thread/items/list") {
      const offset = Number(params.cursor ?? 0);
      const limit = Number(params.limit);
      const data = entries.slice().reverse().slice(offset, offset + limit);
      return { data, nextCursor: offset + data.length < entries.length ? String(offset + data.length) : null };
    }
    return {};
  });
}

describe("opening a thread", () => {
  it.each([
    [null, "ready"],
    [new RpcError(-32000, "thread is archived"), "archived"],
    [new RpcError(-32000, "thread has an active writer"), "locked"],
    [new RpcError(-32000, "direct app-server input is not allowed"), "ready"],
  ])("shows the first page before background history arrives (%s)", async (resumeError, state) => {
    let resolveOlder!: (page: v2.ThreadItemsListResponse) => void;
    const older = new Promise<v2.ThreadItemsListResponse>((resolve) => { resolveOlder = resolve; });
    const latest = conversation(1);
    const earlier = conversation(24).map((entry) => ({ ...entry, item: { ...entry.item, id: `old-${entry.item.id}` } }));
    const { rpc, calls } = stubRpc((method, params) => {
      if (method === "thread/resume") return resumeError ?? resumed;
      if (method === "thread/read") return { thread: { id: "t1", cwd: "/proj", status: { type: "idle" } } };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "thread/items/list") return params.cursor ? older : { data: latest.slice().reverse(), nextCursor: "older" };
      return { queue: [] };
    });
    const session = new Session(rpc);
    await session.openThread("t1");

    expect(session.store.get().open).toMatchObject({ state, loadingOlder: true });
    expect(session.store.get().open!.view.items).toEqual(latest.map((entry) => entry.item));
    await session.loadOlder();
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(2);

    resolveOlder({ data: earlier.slice().reverse(), nextCursor: null, backwardsCursor: null });
    await vi.waitFor(() => expect(session.store.get().open!.loadingOlder).toBe(false));
    expect(userIds(session)).toHaveLength(20);
    expect(session.store.get().open!.olderEntries).toHaveLength(10);
    await session.loadOlder();
    expect(userIds(session)).toHaveLength(25);
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(2);
  });

  it("preserves live output and pending messages while background history loads", async () => {
    let resolveOlder!: (page: v2.ThreadItemsListResponse) => void;
    const older = new Promise<v2.ThreadItemsListResponse>((resolve) => { resolveOlder = resolve; });
    const latest = [userMessage("latest", "turn1"), answer("live", "turn1")];
    const { rpc } = stubRpc((method, params) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/items/list") return params.cursor ? older : { data: latest.slice().reverse(), nextCursor: "older" };
      return { data: [], nextCursor: null, queue: [] };
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    session.handleNotification({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: "t1", turnId: "turn1", itemId: "live", delta: "New output" } });
    session.handleNotification({ jsonrpc: "2.0", method: "turn/started", params: { threadId: "t1", turn: { id: "new", status: "inProgress" } } });
    session.store.set((s) => ({ ...s, open: { ...s.open!, view: { ...s.open!.view, pending: [{ id: "pending", input: [] }] } } }));
    resolveOlder({ data: [latest[0], answer("old-a", "old"), userMessage("old-u", "old")], nextCursor: null, backwardsCursor: null });
    await vi.waitFor(() => expect(session.store.get().open!.loadingOlder).toBe(false));

    const view = session.store.get().open!.view;
    expect(view.items.map((item) => item.id)).toEqual(["old-u", "old-a", "latest", "live"]);
    expect(view.items[3]).toMatchObject({ text: `${"A long answer. ".repeat(200)}New output` });
    expect(view.pending).toEqual([{ id: "pending", input: [] }]);
    expect(view.activeTurnId).toBe("new");
  });

  it("keeps the first page and retry cursor when background history fails", async () => {
    let fail = true;
    const { rpc } = stubRpc((method, params) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/items/list") {
        if (!params.cursor) return { data: conversation(1).reverse(), nextCursor: "older" };
        return fail ? new Error("history unavailable") : { data: [userMessage("old", "old")], nextCursor: null };
      }
      return { data: [], nextCursor: null, queue: [] };
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    await vi.waitFor(() => expect(session.store.get().open!.loadingOlder).toBe(false));
    expect(session.store.get().open).toMatchObject({ state: "ready", error: null, olderCursor: "older" });
    expect(userIds(session)).toEqual(["u0"]);
    fail = false;
    await session.loadOlder();
    expect(userIds(session)).toEqual(["old", "u0"]);
  });

  it("ignores background history after switching away and reopening the same thread", async () => {
    let resolveOlder!: (page: v2.ThreadItemsListResponse) => void;
    const older = new Promise<v2.ThreadItemsListResponse>((resolve) => { resolveOlder = resolve; });
    let first = true;
    const { rpc, calls } = stubRpc((method, params) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/items/list") {
        if (params.cursor) return older;
        if (first) return { data: conversation(1).reverse(), nextCursor: "older" };
        return { data: [userMessage("reopened", "new")], nextCursor: null };
      }
      return { data: [], nextCursor: null, queue: [] };
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    first = false;
    await session.openThread("t2");
    await session.openThread("t1");
    resolveOlder({ data: [userMessage("stale", "old")], nextCursor: "even-older", backwardsCursor: null });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(userIds(session)).toEqual(["reopened"]);
    expect(session.store.get().open).toMatchObject({ state: "ready", loadingOlder: false, olderCursor: null });
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(4);
  });

  it("keeps paging until the message that started the newest turn is on screen", async () => {
    // What Codex really hands back: a page of a long turn's tool calls with
    // the message that started it stranded on the page before.
    const { rpc, calls } = historyRpc([
      [command("c1", "turn1"), command("c2", "turn1")],
      [userMessage("u1", "turn1"), command("c0", "turn1")],
    ]);
    const session = new Session(rpc);
    await session.openThread("t1");
    await vi.waitFor(() => expect(session.store.get().open!.loadingOlder).toBe(false));

    const view = session.store.get().open!.view;
    expect(view.items.map((i) => i.id)).toEqual(["u1", "c0", "c1", "c2"]);
    expect(calls.filter((c) => c.method === "thread/items/list")).toHaveLength(2);
  });

  it("preloads earlier context even when the newest turn is already whole", async () => {
    const { rpc, calls } = historyRpc([[command("c0", "turn1"), userMessage("u2", "turn2"), command("c1", "turn2")], [userMessage("u1", "turn1")]]);
    const session = new Session(rpc);
    await session.openThread("t1");
    await vi.waitFor(() => expect(session.store.get().open!.loadingOlder).toBe(false));

    expect(session.store.get().open!.view.items.map((i) => i.id)).toEqual(["u1", "c0", "u2", "c1"]);
    expect(calls.filter((c) => c.method === "thread/items/list")).toHaveLength(2);
    expect(session.store.get().open!.olderCursor).toBeNull();
  });

  it("loads 20 user messages even when work records require more than four requests", async () => {
    const entries = conversation(25, 25);
    const { rpc, calls } = paginatedHistoryRpc(entries);
    const session = new Session(rpc);
    await session.openThread("t1");
    await vi.waitFor(() => expect(session.store.get().open!.loadingOlder).toBe(false));

    expect(userIds(session)).toEqual(Array.from({ length: 20 }, (_, i) => `u${i + 5}`));
    expect(session.store.get().open!.view.items).toEqual(entries.slice(5 * 27).map((entry) => entry.item));
    expect(calls.filter((call) => call.method === "thread/items/list").length).toBeGreaterThan(4);
  });

  it("loads another 20 user messages on each scroll without dropping overfetched items", async () => {
    const entries = conversation(45);
    const { rpc, calls } = paginatedHistoryRpc(entries);
    const session = new Session(rpc);
    await session.openThread("t1");
    expect(userIds(session)).toHaveLength(20);
    expect(userIds(session)[0]).toBe("u25");

    await session.loadOlder();
    expect(userIds(session)).toHaveLength(40);
    expect(userIds(session)[0]).toBe("u5");
    // The server is exhausted, but its last response left a buffered tail.
    expect(session.store.get().open!.olderCursor).toBeNull();
    expect(session.store.get().open!.olderEntries!.length).toBeGreaterThan(0);

    const requests = calls.filter((call) => call.method === "thread/items/list").length;
    await session.loadOlder();
    expect(session.store.get().open!.view.items).toEqual(entries.map((entry) => entry.item));
    expect(userIds(session)).toHaveLength(45);
    expect(session.store.get().open!.olderEntries).toEqual([]);
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(requests);
    await session.loadOlder();
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(requests);
  });

  it("counts each steered user message even when all 20 share one turn", async () => {
    const current = Array.from({ length: 20 }, (_, i) => [userMessage(`steer${i}`, "turn1"), command(`c${i}`, "turn1")]).flat();
    const { rpc, calls } = historyRpc([current, [userMessage("older", "turn0")]]);
    const session = new Session(rpc);
    await session.openThread("t1");

    expect(userIds(session)).toHaveLength(20);
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(1);
    expect(session.store.get().open!.olderCursor).toBe("1");
  });

  it("does not count overlapping records or live messages twice when loading older history", async () => {
    const newest = conversation(20);
    const older = Array.from({ length: 20 }, (_, i) => [userMessage(`old${i}`, `older${i}`), answer(`a-old${i}`, `older${i}`)]).flat();
    const { rpc } = historyRpc([newest, [newest[0], ...older.slice(20)], older.slice(0, 20)]);
    const session = new Session(rpc);
    await session.openThread("t1");
    await session.loadOlder();

    expect(userIds(session)).toHaveLength(40);
    const ids = session.store.get().open!.view.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(userIds(session)[0]).toBe("old0");
  });

  it("keeps already loaded messages and the retry cursor when an optional context page fails", async () => {
    const { rpc } = stubRpc((method, params) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "thread/queue/list") return { queue: [] };
      if (method === "thread/items/list") {
        if (params.cursor) return new Error("temporary history failure");
        return { data: [answer("a1", "turn1"), userMessage("u1", "turn1")], nextCursor: "older" };
      }
      return {};
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    await vi.waitFor(() => expect(session.store.get().open!.loadingOlder).toBe(false));

    expect(session.store.get().open!.state).toBe("ready");
    expect(session.store.get().open!.view.items.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(session.store.get().open!.olderCursor).toBe("older");
  });

  it("keeps partial older history and retries from the failed cursor", async () => {
    let fail = true;
    const { rpc } = stubRpc((method, params) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "thread/queue/list") return { queue: [] };
      if (method === "thread/items/list") {
        if (!params.cursor) return { data: conversation(20).reverse(), nextCursor: "partial" };
        if (params.cursor === "partial") return { data: [answer("old-a", "old"), userMessage("old-u", "old")], nextCursor: "retry" };
        if (fail) return new Error("temporary history failure");
        return { data: [userMessage("oldest-u", "oldest")], nextCursor: null };
      }
      return {};
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    await session.loadOlder();
    expect(userIds(session)).toHaveLength(21);
    expect(session.store.get().open!.olderCursor).toBe("retry");
    expect(session.store.get().open!.loadingOlder).toBe(false);
    fail = false;
    await session.loadOlder();
    expect(userIds(session)).toHaveLength(22);
    expect(session.store.get().open!.olderCursor).toBeNull();
  });

  it("can paginate archived read-only conversations", async () => {
    const entries = conversation(25);
    const { rpc } = paginatedHistoryRpc(entries, new RpcError(-32000, "thread is archived"));
    const session = new Session(rpc);
    await session.openThread("t1");
    expect(session.store.get().open!.state).toBe("archived");
    expect(userIds(session)).toHaveLength(20);
    await session.loadOlder();
    expect(userIds(session)).toHaveLength(25);
  });

  it("uses the same user-message pages for the full-read fallback", async () => {
    const entries = conversation(25);
    const { rpc, calls } = stubRpc((method) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/items/list") return new RpcError(-32000, "thread/items/list is not supported yet");
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "thread/read") return { thread: { turns: Array.from({ length: 25 }, (_, i) => ({ id: `turn${i}`, items: entries.slice(i * 2, i * 2 + 2).map((entry) => entry.item) })) } };
      return { queue: [] };
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    expect(userIds(session)).toHaveLength(20);
    expect(session.store.get().open!.olderCursor).toBeNull();
    await session.loadOlder();
    expect(session.store.get().open!.view.items).toEqual(entries.map((entry) => entry.item));
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(1);
  });

  it("stops fetching an older page when its conversation is closed", async () => {
    let resolvePage!: (page: { data: v2.ThreadItemEntry[]; nextCursor: string | null }) => void;
    const delayed = new Promise((resolve) => { resolvePage = resolve; });
    const { rpc, calls } = stubRpc((method, params) => {
      if (method === "thread/resume") return resumed;
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "thread/items/list") {
        if (!params.cursor) return { data: conversation(20).reverse(), nextCursor: "older" };
        return delayed;
      }
      return { queue: [] };
    });
    const session = new Session(rpc);
    await session.openThread("t1");
    const loading = session.loadOlder();
    // A second scroll must not start another fetch while the first is pending.
    await session.loadOlder();
    await session.closeThread();
    resolvePage({ data: [command("c-old", "old")], nextCursor: "even-older" });
    await loading;
    expect(session.store.get().open).toBeNull();
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(2);
  });
});
