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
