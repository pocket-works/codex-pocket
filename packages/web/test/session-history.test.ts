import { describe, expect, it } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import type { RpcClient } from "../src/rpc/client.js";
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

describe("opening a thread", () => {
  it("keeps paging until the message that started the newest turn is on screen", async () => {
    // What Codex really hands back: a page of a long turn's tool calls with
    // the message that started it stranded on the page before.
    const { rpc, calls } = historyRpc([
      [command("c1", "turn1"), command("c2", "turn1")],
      [userMessage("u1", "turn1"), command("c0", "turn1")],
    ]);
    const session = new Session(rpc);
    await session.openThread("t1");

    const view = session.store.get().open!.view;
    expect(view.items.map((i) => i.id)).toEqual(["u1", "c0", "c1", "c2"]);
    expect(calls.filter((c) => c.method === "thread/items/list")).toHaveLength(2);
  });

  it("preloads earlier context even when the newest turn is already whole", async () => {
    const { rpc, calls } = historyRpc([[command("c0", "turn1"), userMessage("u2", "turn2"), command("c1", "turn2")], [userMessage("u1", "turn1")]]);
    const session = new Session(rpc);
    await session.openThread("t1");

    expect(session.store.get().open!.view.items.map((i) => i.id)).toEqual(["u1", "c0", "u2", "c1"]);
    expect(calls.filter((c) => c.method === "thread/items/list")).toHaveLength(2);
    expect(session.store.get().open!.olderCursor).toBeNull();
  });

  it("preloads three recent turns on a cold open from a notification", async () => {
    const { rpc, calls } = historyRpc([
      [userMessage("u3", "turn3"), ...Array.from({ length: 38 }, (_, index) => command(`c${index}`, "turn3")), answer("a3", "turn3")],
      [userMessage("u2", "turn2"), answer("a2", "turn2")],
      [userMessage("u1", "turn1"), answer("a1", "turn1")],
      [userMessage("u0", "turn0"), answer("a0", "turn0")],
    ]);
    const session = new Session(rpc);
    await session.openThread("t1");

    expect(session.store.get().open!.view.items.filter((item) => item.type === "userMessage").map((item) => item.id)).toEqual(["u1", "u2", "u3"]);
    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(3);
    expect(session.store.get().open!.olderCursor).toBe("3");
    await session.loadOlder();
    expect(session.store.get().open!.view.items[0].id).toBe("u0");
    expect(session.store.get().open!.olderCursor).toBeNull();
  });

  it("does not fetch an extra page when three complete turns are already present", async () => {
    const { rpc, calls } = historyRpc([
      [userMessage("u1", "turn1"), answer("a1", "turn1"), userMessage("u2", "turn2"), answer("a2", "turn2"), userMessage("u3", "turn3"), answer("a3", "turn3")],
      [userMessage("u0", "turn0")],
    ]);
    const session = new Session(rpc);
    await session.openThread("t1");

    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(1);
    expect(session.store.get().open!.olderCursor).toBe("1");
  });

  it("does not count steered messages as separate turns of context", async () => {
    const { rpc, calls } = historyRpc([
      [userMessage("u3", "turn3"), command("c3", "turn3"), userMessage("steer1", "turn3"), command("c4", "turn3"), userMessage("steer2", "turn3"), answer("a3", "turn3")],
      [userMessage("u2", "turn2"), answer("a2", "turn2")],
      [userMessage("u1", "turn1"), answer("a1", "turn1")],
      [userMessage("u0", "turn0")],
    ]);
    const session = new Session(rpc);
    await session.openThread("t1");

    expect(calls.filter((call) => call.method === "thread/items/list")).toHaveLength(3);
    expect(session.store.get().open!.view.items[0].id).toBe("u1");
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

    expect(session.store.get().open!.state).toBe("ready");
    expect(session.store.get().open!.view.items.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(session.store.get().open!.olderCursor).toBe("older");
  });

  it("gives up after a few pages rather than reading a whole thread", async () => {
    const pages = Array.from({ length: 8 }, (_, i) => [command(`c${i}`, "turn1")]);
    const { rpc, calls } = historyRpc(pages);
    const session = new Session(rpc);
    await session.openThread("t1");

    expect(calls.filter((c) => c.method === "thread/items/list")).toHaveLength(4);
    expect(session.store.get().open!.olderCursor).toBe("4");
  });
});
