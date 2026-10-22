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

describe("Session.ensureProject", () => {
  beforeEach(() => memory.clear());

  it("creates a shared project rooted at the existing folder and adds it immediately", async () => {
    const { rpc, calls } = stubRpc((method) => method === "project/list"
      ? { data: [], nextCursor: null }
      : { project: p("p1", "existing-folder", "/p/existing-folder").data[0] });
    const session = new Session(rpc);
    const project = await session.ensureProject("/p/existing-folder/");
    expect(project).toEqual({ id: "p1", name: "existing-folder", roots: ["/p/existing-folder"], position: 0 });
    expect(session.store.get().projects).toEqual([project]);
    expect(calls).toEqual([
      { method: "project/list", params: { sortKey: "position", limit: 200, cursor: null } },
      { method: "project/create", params: { name: "existing-folder", roots: [{ path: "/p/existing-folder" }], idempotencyKey: expect.any(String) } },
    ]);
  });

  it("reuses a secondary root from a freshly loaded later page", async () => {
    const existing = p("p2", "Shared project", "/p/primary").data[0];
    existing.roots.push({ path: "/p/secondary/" });
    const { rpc, calls } = stubRpc((_method, params) => (params as { cursor: string | null }).cursor
      ? { data: [existing], nextCursor: null }
      : p("p1", "one", "/p/one", "next"));
    const session = new Session(rpc);
    expect((await session.ensureProject("/p/secondary")).id).toBe("p2");
    expect(calls.map((call) => call.method)).toEqual(["project/list", "project/list"]);
  });

  it("does not reuse a stale project deleted on the desktop", async () => {
    const { rpc, calls } = stubRpc((method) => method === "project/list"
      ? { data: [], nextCursor: null }
      : { project: p("new", "one", "/p/one").data[0] });
    const session = new Session(rpc);
    session.store.set((s) => ({ ...s, projects: [{ id: "deleted", name: "one", roots: ["/p/one"], position: 0 }] }));
    expect((await session.ensureProject("/p/one")).id).toBe("new");
    expect(calls.map((call) => call.method)).toEqual(["project/list", "project/create"]);
  });

  it("shares concurrent selection requests for the same folder", async () => {
    const { rpc, calls } = stubRpc((method) => method === "project/list"
      ? { data: [], nextCursor: null }
      : { project: p("p1", "one", "/p/one").data[0] });
    const session = new Session(rpc);
    const [first, second] = await Promise.all([session.ensureProject("/p/one"), session.ensureProject("/p/one/")]);
    expect(first).toEqual(second);
    expect(calls.filter((call) => call.method === "project/create")).toHaveLength(1);
  });

  it("keeps the idempotency key when retrying an uncertain creation", async () => {
    let fail = true;
    const { rpc, calls } = stubRpc((method) => method === "project/list"
      ? { data: [], nextCursor: null }
      : fail ? new Error("Connection lost") : { project: p("p1", "one", "/p/one").data[0] });
    const session = new Session(rpc);
    await expect(session.ensureProject("/p/one")).rejects.toThrow("Connection lost");
    expect(session.store.get().projects).toEqual([]);
    fail = false;
    await session.ensureProject("/p/one");
    const creations = calls.filter((call) => call.method === "project/create");
    expect(creations).toHaveLength(2);
    expect(creations[0].params).toEqual(creations[1].params);
  });

  it("does not create a duplicate when the project list cannot be read", async () => {
    const { rpc, calls } = stubRpc(() => new Error("Project API unavailable"));
    const session = new Session(rpc);
    await expect(session.ensureProject("/p/one")).rejects.toThrow("Project API unavailable");
    expect(calls.map((call) => call.method)).toEqual(["project/list"]);
  });

  it("adds a started thread to its project without waiting for a notification", async () => {
    const { rpc, calls } = stubRpc(() => ({
      thread: { id: "t1", cwd: "/p/one", projectId: "p1", preview: "", updatedAt: 1, status: { type: "idle" } },
      cwd: "/p/one", model: "m", reasoningEffort: null, sandbox: { type: "workspaceWrite" },
    }));
    const session = new Session(rpc);
    await session.startThread("/p/one", "m", null, null, "p1");
    expect(calls).toEqual([{ method: "thread/start", params: { cwd: "/p/one", model: "m", serviceTier: null, projectId: "p1" } }]);
    expect(session.store.get().threads).toMatchObject([{ id: "t1", cwd: "/p/one", projectId: "p1" }]);
  });

  it("does not let an older list response erase a newly created project", async () => {
    let finishCreation!: (response: unknown) => void;
    let finishList!: (response: unknown) => void;
    let reads = 0;
    const { rpc } = stubRpc((method) => {
      if (method === "project/create") return new Promise((resolve) => { finishCreation = resolve; });
      return ++reads === 1 ? { data: [], nextCursor: null } : new Promise((resolve) => { finishList = resolve; });
    });
    const session = new Session(rpc);
    const creation = session.ensureProject("/p/one");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const olderList = session.loadProjects();
    finishCreation({ project: p("p1", "one", "/p/one").data[0] });
    await creation;
    finishList({ data: [], nextCursor: null });
    await olderList;
    expect(session.store.get().projects.map((project) => project.id)).toEqual(["p1"]);
  });
});
