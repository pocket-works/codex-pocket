// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import type { RpcClient } from "../src/rpc/client.js";
import { emptyDraft, type Draft } from "../src/state/compose.js";
import { Session } from "../src/state/session.js";
import { NewThread } from "../src/ui/NewThread.js";
import { ThreadList } from "../src/ui/ThreadList.js";

let sent: Promise<void> | undefined;
vi.mock("../src/ui/Composer.js", () => ({
  Composer: ({ onSend, disabled }: { onSend: (draft: Draft) => Promise<void>; disabled: boolean }) => createElement("button", {
    "aria-label": "Send", disabled, onClick: () => { sent = onSend({ ...emptyDraft, text: "Work in this folder" }); },
  }, "Send"),
}));
vi.mock("../src/state/host-client.js", () => ({
  hostClientFor: () => ({ me: async () => ({ host: "Mac", home: "/Users/me" }) }),
}));

let container: HTMLDivElement;
let root: Root;
let session: Session;
beforeEach(() => {
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  sent = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  session?.dispose();
  container.remove();
  vi.unstubAllGlobals();
});

function fixture(existing: v2.Project[] = []) {
  let projects = existing;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let createError: Error | null = null;
  const rpc = {
    connectionState: "open",
    stop() {},
    notify() {},
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "project/list") return { data: projects, nextCursor: null };
      if (method === "project/create") {
        if (createError) throw createError;
        const project = { id: "shared-project", name: params.name, roots: params.roots, metadata: {}, position: 0, createdAt: 0, updatedAt: 0, recencyAt: null } as v2.Project;
        projects = [...projects, project];
        return { project };
      }
      if (method === "thread/list" || method === "model/list") return { data: [], nextCursor: null };
      if (method === "fs/readDirectory") return { entries: params.path === "/" ? [{ fileName: "existing-folder", isDirectory: true }] : [] };
      if (method === "command/exec") return { stdout: "", stderr: "", exitCode: 1 };
      if (method === "thread/start") return {
        thread: { id: "thread", cwd: params.cwd, projectId: params.projectId, preview: "", updatedAt: 1, model: "m", status: { type: "idle" } },
        cwd: params.cwd, model: "m", reasoningEffort: null, serviceTier: null,
        approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" },
      };
      if (method === "turn/start") return { turn: { id: "turn", status: "inProgress", items: [] } };
      return {};
    },
    onStateChange: () => () => {},
    onNotification: () => () => {},
    onServerRequest: () => () => {},
  } as unknown as RpcClient;
  session = new Session(rpc);
  session.openDraft("");
  return { calls, failCreation: (error: Error | null) => { createError = error; } };
}

async function click(selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

async function browse() {
  await act(async () => root.render(createElement(NewThread, { session })));
  await click(".target-anchor > button");
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Browse folders…");
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await click(".folder-list button");
}

async function send() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click();
    await sent;
  });
}

describe("shared project folder selection", () => {
  it("creates an official project on Use, then assigns the new thread and displays it", async () => {
    const { calls } = fixture();
    await browse();
    await click(".folder-path .primary");
    expect(container.querySelector(".folder-browser")).toBeNull();
    expect(session.store.get().projects).toMatchObject([{ id: "shared-project", roots: ["/existing-folder"] }]);
    expect(calls.filter((call) => call.method === "project/create")).toHaveLength(1);
    expect(calls.some((call) => call.method === "thread/start")).toBe(false);
    await send();
    expect(calls.find((call) => call.method === "thread/start")?.params).toMatchObject({ cwd: "/existing-folder", projectId: "shared-project" });
    expect(calls.filter((call) => call.method === "project/create")).toHaveLength(1);
    // Keep the response-backed thread visible while testing the list itself.
    vi.spyOn(session, "loadThreads").mockResolvedValue(undefined);
    await act(async () => root.render(createElement(ThreadList, { session })));
    expect(container.querySelector(".project-name")?.textContent).toBe("existing-folder");
    await click(".project-main");
    expect(container.querySelector(".thread-list.nested")?.textContent).toContain("Work in this folder");
  });

  it("reuses an official project with a custom name when selecting the same folder", async () => {
    const { calls } = fixture([{ id: "existing", name: "Custom project", roots: [{ path: "/existing-folder" }], metadata: {}, position: 0, createdAt: 0, updatedAt: 0, recencyAt: null }]);
    await browse();
    await click(".folder-path .primary");
    await send();
    expect(calls.some((call) => call.method === "project/create")).toBe(false);
    expect(calls.find((call) => call.method === "thread/start")?.params.projectId).toBe("existing");
    expect(session.store.get().projects[0].name).toBe("Custom project");
  });

  it("shows a creation failure, preserves the current target and allows retry", async () => {
    const { calls, failCreation } = fixture();
    failCreation(new Error("Could not save project"));
    await browse();
    await click(".folder-path .primary");
    expect(container.querySelector(".folder-browser .error")?.textContent).toContain("Could not save project");
    expect(container.querySelector<HTMLButtonElement>(".folder-path .primary")?.disabled).toBe(false);
    expect(session.store.get().projects).toEqual([]);
    expect(session.store.get().open?.cwd).toBe("");
    expect(calls.some((call) => call.method === "thread/start")).toBe(false);
    failCreation(null);
    await click(".folder-path .primary");
    expect(container.querySelector(".folder-browser")).toBeNull();
    expect(session.store.get().open?.cwd).toBe("/existing-folder");
    const creations = calls.filter((call) => call.method === "project/create");
    expect(creations[0].params.idempotencyKey).toBe(creations[1].params.idempotencyKey);
  });

  it("leaves the project list unchanged if browsing is cancelled", async () => {
    const { calls } = fixture();
    await browse();
    await act(async () => container.querySelector(".folder-browser")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".folder-browser")).toBeNull();
    expect(calls.some((call) => call.method === "project/create")).toBe(false);
    expect(session.store.get().projects).toEqual([]);
  });

  it("keeps an ordinary Chat project-less", async () => {
    const { calls } = fixture();
    vi.spyOn(session, "createScratchDir").mockResolvedValue("/Users/me/Documents/Codex/2026-10-13/chat");
    await act(async () => root.render(createElement(NewThread, { session })));
    await send();
    expect(calls.find((call) => call.method === "thread/start")?.params).toMatchObject({ projectId: null, cwd: "/Users/me/Documents/Codex/2026-10-13/chat" });
    expect(calls.some((call) => call.method === "project/create")).toBe(false);
  });

  it("assigns a new worktree to the project of the selected original folder", async () => {
    const { calls } = fixture();
    vi.spyOn(session, "gitInfo").mockResolvedValue({ branch: "main", branches: ["main"] });
    vi.spyOn(session, "gitWorktreeAdd").mockResolvedValue("/Users/me/.codex/worktrees/new/existing-folder");
    await act(async () => root.render(createElement(NewThread, { session, presetCwd: "/existing-folder" })));
    const local = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Work locally")!;
    await act(async () => local.click());
    const worktree = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) => button.textContent === "New worktree")!;
    await act(async () => worktree.click());
    await send();
    expect(calls.find((call) => call.method === "project/create")?.params.roots).toEqual([{ path: "/existing-folder" }]);
    expect(calls.find((call) => call.method === "thread/start")?.params).toMatchObject({ cwd: "/Users/me/.codex/worktrees/new/existing-folder", projectId: "shared-project" });
  });
});
