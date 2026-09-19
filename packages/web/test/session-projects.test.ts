import { beforeEach, describe, expect, it } from "vitest";
import type { RpcClient } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

function stubRpc(answer: (method: string, params: unknown) => unknown) {
  const calls: { method: string; params: unknown }[] = [];
  const rpc = {
    connectionState: "open",
    start() {},
    notify() {},
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

const p = (id: string, name: string, path: string, cursor: string | null = null) => ({
  data: [{ id, name, roots: [{ path }], metadata: {}, position: 0, createdAt: 0, updatedAt: 0, recencyAt: null }],
  nextCursor: cursor,
});

describe("Session.loadProjects", () => {
  beforeEach(() => memory.clear());

  it("follows the cursor so projects past the default page size are kept", async () => {
    const { rpc, calls } = stubRpc((method, params) => {
      if (method !== "project/list") return {};
      return (params as { cursor: string | null }).cursor ? p("p2", "two", "/p/two") : p("p1", "one", "/p/one", "c1");
    });
    const session = new Session(rpc);
    await session.loadProjects();
    expect(session.store.get().projects.map((x) => x.name)).toEqual(["one", "two"]);
    expect(calls).toEqual([
      { method: "project/list", params: { sortKey: "position", limit: 200, cursor: null } },
      { method: "project/list", params: { sortKey: "position", limit: 200, cursor: "c1" } },
    ]);
  });

  it("keeps the previous list when the app-server has no project API", async () => {
    const { rpc } = stubRpc(() => new Error("project/list requires experimentalApi capability"));
    const session = new Session(rpc);
    await session.loadProjects();
    expect(session.store.get().projects).toEqual([]);
  });

  it("re-reads the list on project/changed, so a desktop deletion disappears here", async () => {
    // The desktop deletes the project between the first read and the notification.
    let alive = true;
    const { rpc, calls } = stubRpc((method) => {
      if (method !== "project/list") return {};
      return alive ? p("p1", "one", "/p/one") : { data: [], nextCursor: null };
    });
    const session = new Session(rpc);
    await session.loadProjects();
    expect(session.store.get().projects).toHaveLength(1);

    alive = false;
    session.handleNotification({ method: "project/changed", params: { projectId: "p1", changeType: "deleted" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((c) => c.method === "project/list")).toHaveLength(2);
    expect(session.store.get().projects).toEqual([]);
  });
});
