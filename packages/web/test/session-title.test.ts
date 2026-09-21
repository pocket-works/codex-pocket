import { describe, expect, it } from "vitest";
import type { RpcClient } from "../src/rpc/client.js";
import { cleanTitle, Session } from "../src/state/session.js";
import type { ThreadSummary } from "../src/state/thread-list.js";
import { applyThreadListNotification } from "../src/state/thread-list.js";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

const summary = (extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: "t1",
  cwd: "/proj",
  projectId: null,
  title: "Please look into why the login page flashes white before rendering on iOS",
  preview: "Please look into why the login page flashes white before rendering on iOS",
  updatedAt: 1,
  model: "gpt-x",
  status: "idle",
  waitingFor: null,
  unread: false,
  branch: null,
  named: false,
  ...extra,
});

function stubRpc() {
  const calls: { method: string; params: unknown }[] = [];
  const rpc = {
    connectionState: "open",
    start() {},
    notify() {},
    request(method: string, params: unknown) {
      calls.push({ method, params });
      if (method === "thread/start") return Promise.resolve({ thread: { id: "eph", ephemeral: true }, model: "gpt-x", cwd: "/proj" });
      return Promise.resolve({});
    },
    respond() {},
    respondError() {},
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

const completed = (threadId: string) => ({ jsonrpc: "2.0" as const, method: "turn/completed", params: { threadId, turn: { id: "x", status: "completed" } } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("automatic titles", () => {
  it("asks an ephemeral thread for a title after the first turn and names the thread with it", async () => {
    const { rpc, calls } = stubRpc();
    const session = new Session(rpc);
    session.store.set((s) => ({ ...s, threads: [summary()] }));
    session.handleNotification(completed("t1"));
    await tick();
    await tick();
    expect(calls.map((c) => c.method)).toEqual(["thread/start", "turn/start"]);
    expect(calls[0].params).toMatchObject({ ephemeral: true, cwd: "/proj", model: "gpt-x", approvalPolicy: "never", sandbox: "read-only" });
    // The titling thread's traffic is collected, never shown.
    session.handleNotification({ jsonrpc: "2.0", method: "item/completed", params: { threadId: "eph", turnId: "u", item: { type: "agentMessage", id: "a1", text: "“Login page white flash on iOS.”\n", phase: null, memoryCitation: null, delivery: null, questions: null } } });
    session.handleNotification(completed("eph"));
    await tick();
    await tick();
    expect(calls[2]).toEqual({ method: "thread/name/set", params: { threadId: "t1", name: "Login page white flash on iOS" } });
    expect(session.store.get().threads[0].title).toBe("Login page white flash on iOS");
    // t1 finishing off screen is news; the titling thread finishing is not.
    expect(session.store.get().toasts.map((t) => t.threadId)).toEqual(["t1"]);
  });

  it("leaves short prompts and already-named threads alone", async () => {
    const { rpc, calls } = stubRpc();
    const session = new Session(rpc);
    session.store.set((s) => ({ ...s, threads: [summary({ preview: "hi", title: "hi" }), summary({ id: "t2", named: true })] }));
    session.handleNotification(completed("t1"));
    session.handleNotification(completed("t2"));
    await tick();
    expect(calls).toEqual([]);
  });

  it("does not list ephemeral threads", () => {
    const list = applyThreadListNotification([], { method: "thread/started", params: { thread: { id: "eph", ephemeral: true, cwd: "/p", name: null, preview: "", updatedAt: 1, status: { type: "idle" }, model: null } } }, 0);
    expect(list).toEqual([]);
  });
});

describe("cleanTitle", () => {
  it("strips quotes, markdown and trailing punctuation, keeps one line", () => {
    expect(cleanTitle('# "Fix the flaky test."\nmore')).toBe("Fix the flaky test");
    expect(cleanTitle("「修复登录闪白」。")).toBe("修复登录闪白");
    expect(cleanTitle("   \n  ")).toBe("");
  });
});
