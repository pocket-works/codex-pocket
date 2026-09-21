import { describe, expect, it } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import { groupByProject, projectForCwd, summarizeProjects, type ProjectSummary } from "../src/state/projects.js";
import { applyThreadListNotification } from "../src/state/thread-list.js";
import type { ThreadSummary } from "../src/state/thread-list.js";

const t = (id: string, cwd: string, updatedAt: number, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  cwd,
  projectId: null,
  title: id,
  preview: "",
  updatedAt,
  model: null,
  status: "idle",
  waitingFor: null,
  unread: false,
  branch: null,
  named: false,
  ...extra,
});

const project = (id: string, name: string, roots: string[], position = 0): ProjectSummary => ({ id, name, roots, position });

describe("summarizeProjects", () => {
  it("keeps the id, name and every root", () => {
    const raw = [{ id: "p1", name: "flow", roots: [{ path: "/p/flow" }, { path: "/p/flow-server" }], metadata: {}, position: 3, createdAt: 0, updatedAt: 0, recencyAt: null }] as v2.Project[];
    expect(summarizeProjects(raw)).toEqual([{ id: "p1", name: "flow", roots: ["/p/flow", "/p/flow-server"], position: 3 }]);
  });
});

describe("projectForCwd", () => {
  it("returns null for a folder that no project owns", () => {
    expect(projectForCwd("/Users/me/Projects/example-app", [project("p1", "other", ["/Users/me/Projects/other"])])).toBeNull();
  });

  it("does not absorb subfolders of a project root", () => {
    const projects = [project("p1", "codex-pocket", ["/Users/me/Projects/codex-pocket"])];
    expect(projectForCwd("/Users/me/Projects/codex-pocket", projects)?.id).toBe("p1");
    expect(projectForCwd("/Users/me/Projects/codex-pocket/packages/host", projects)).toBeNull();
    // The home-root project must not claim every folder underneath it.
    expect(projectForCwd("/Users/me/Projects/example-app", [project("home", "me", ["/Users/me"])])).toBeNull();
  });

  it("tolerates a trailing slash on either side", () => {
    const projects = [project("p1", "one", ["/p/one/"])];
    expect(projectForCwd("/p/one", projects)?.id).toBe("p1");
  });

  it("ignores a stale projectId that is no longer in the list, like one deleted on the desktop", () => {
    const projects = [project("p1", "one", ["/p/one"])];
    expect(projectForCwd("/p/one", projects, "deleted-project")?.id).toBe("p1");
    expect(projectForCwd("/p/stray", projects, "deleted-project")).toBeNull();
  });

  it("does not treat every folder under the home root as a project root match for '/'", () => {
    expect(projectForCwd("/p/one", [project("root", "root", ["/"])])).toBeNull();
  });
});

describe("groupByProject", () => {
  it("shows each project exactly once even when its threads span several roots", () => {
    const projects = [project("p1", "flow", ["/p/flow", "/p/flow-server"])];
    const { groups, ungrouped } = groupByProject([t("a", "/p/flow", 10), t("b", "/p/flow-server", 20), t("c", "/p/flow/sub", 5)], projects);
    expect(groups).toHaveLength(1);
    expect(groups[0].threads.map((x) => x.id)).toEqual(["b", "a"]);
    // /p/flow/sub is not a root, so it is not folded into "flow".
    expect(ungrouped.map((x) => x.id)).toEqual(["c"]);
  });

  it("drops a deleted project's threads into ungrouped rather than reviving the project", () => {
    const projects = [project("p1", "one", ["/p/one"])];
    const { groups, ungrouped } = groupByProject([t("a", "/p/one", 10), t("b", "/p/clay", 20)], projects);
    expect(groups.map((g) => g.project.name)).toEqual(["one"]);
    expect(ungrouped.map((x) => x.id)).toEqual(["b"]);
  });
});

describe("thread/project/updated", () => {
  it("moves a thread to its new project without a refresh", () => {
    const list = [t("a", "/p/one", 10)];
    const next = applyThreadListNotification(list, { method: "thread/project/updated", params: { threadId: "a", projectId: "p2" } }, 1);
    expect(next[0].projectId).toBe("p2");
  });

  it("can clear the assignment when the thread becomes project-less", () => {
    const list = [t("a", "/p/one", 10, { projectId: "p1" })];
    const next = applyThreadListNotification(list, { method: "thread/project/updated", params: { threadId: "a", projectId: null } }, 1);
    expect(next[0].projectId).toBeNull();
  });
});
