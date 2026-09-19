import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "../src/ui/route.js";
import { isScratchThread } from "../src/ui/ThreadList.js";
import { groupByProject, projectForCwd, type ProjectSummary } from "../src/state/projects.js";
import { optionLabels, scratchDir } from "../src/ui/NewThread.js";
import type { ThreadSummary } from "../src/state/session.js";

const t = (id: string, cwd: string, updatedAt: number, projectId: string | null = null): ThreadSummary => ({
  id,
  cwd,
  projectId,
  title: id,
  preview: "",
  updatedAt,
  model: null,
  status: "idle",
  waitingFor: null,
  unread: false,
  branch: null,
});

const project = (id: string, name: string, roots: string[], position = 0): ProjectSummary => ({ id, name, roots, position });

describe("groupByProject", () => {
  it("groups by the app-server's projects, newest project first", () => {
    const projects = [project("p1", "one", ["/p/one"]), project("p2", "two", ["/p/two"])];
    const { groups, ungrouped } = groupByProject([t("a", "/p/one", 10), t("b", "/p/two", 30), t("c", "/p/one", 20)], projects);
    expect(groups.map((g) => g.project.name)).toEqual(["two", "one"]);
    expect(groups[1].threads.map((x) => x.id)).toEqual(["c", "a"]);
    expect(ungrouped).toEqual([]);
  });

  it("keeps a multi-root project as one group", () => {
    const projects = [project("p1", "flow", ["/p/flow", "/p/flow-server"])];
    const { groups } = groupByProject([t("a", "/p/flow", 10), t("b", "/p/flow-server", 20)], projects);
    expect(groups).toHaveLength(1);
    expect(groups[0].threads.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("leaves folders that match no project ungrouped instead of naming them", () => {
    const projects = [project("p1", "one", ["/p/one"])];
    const { groups, ungrouped } = groupByProject([t("a", "/p/one", 10), t("b", "/p/gone", 20)], projects);
    expect(groups.map((g) => g.project.name)).toEqual(["one"]);
    expect(ungrouped.map((x) => x.id)).toEqual(["b"]);
  });

  it("lists an empty project so it can still be opened", () => {
    const projects = [project("p1", "empty", ["/p/empty"])];
    const { groups } = groupByProject([], projects);
    expect(groups.map((g) => g.project.name)).toEqual(["empty"]);
    expect(groups[0].threads).toEqual([]);
  });

  it("honours an explicit projectId even when the cwd does not match", () => {
    const projects = [project("p1", "one", ["/p/one"]), project("p2", "two", ["/p/two"])];
    const { groups } = groupByProject([t("a", "/p/two", 10, "p1")], projects);
    const one = groups.find((g) => g.project.id === "p1");
    expect(one?.threads.map((x) => x.id)).toEqual(["a"]);
  });

  it("matches a root exactly, so a folder inside a project is not absorbed by it", () => {
    const projects = [project("outer", "home", ["/Users/me"]), project("inner", "proj", ["/Users/me/proj"])];
    expect(projectForCwd("/Users/me/proj", projects)?.id).toBe("inner");
    expect(projectForCwd("/Users/me", projects)?.id).toBe("outer");
    // A repo or scratch dir under the home root belongs to no project, which is
    // what keeps a deleted project's leftover folders from reappearing.
    expect(projectForCwd("/Users/me/Projects/clay", projects)).toBeNull();
    expect(projectForCwd("/Users/me/Documents/Codex/2026-09-19/x", projects)).toBeNull();
  });

  it("folds ~/.codex/worktrees checkouts into the project with the same name", () => {
    const projects = [project("p1", "flow", ["/Users/me/Projects/flow"])];
    const { groups } = groupByProject([
      t("a", "/Users/me/Projects/flow", 10),
      t("b", "/Users/me/.codex/worktrees/347a/flow", 30),
      t("c", "/Users/me/.codex/worktrees/05bc/flow", 20),
    ], projects);
    expect(groups.map((g) => g.project.name)).toEqual(["flow"]);
    expect(groups[0].threads.map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(groups[0].updatedAt).toBe(30);
  });
});

describe("isScratchThread", () => {
  it("treats the desktop app's ~/Documents/Codex scratch dirs as project-less chats", () => {
    expect(isScratchThread(t("a", "/Users/me/Documents/Codex/2026-05-26/new-chat", 1))).toBe(true);
    expect(isScratchThread(t("b", "/Users/me/Projects/codex-pocket", 1))).toBe(false);
    expect(isScratchThread(t("c", "/Users/me/Documents/Codex", 1))).toBe(false);
  });
});

describe("routes", () => {
  it("round-trips new-thread routes with a preset cwd", () => {
    const r = { name: "new" as const, cwd: "/Users/me/proj x" };
    expect(parseRoute(routeHash(r))).toEqual(r);
  });

  it("parses archived and settings", () => {
    expect(parseRoute("#/archived")).toEqual({ name: "archived" });
    expect(parseRoute("#/settings")).toEqual({ name: "settings" });
    expect(parseRoute("#/nope")).toEqual({ name: "list" });
  });
});

describe("optionLabels", () => {
  it("shows folder names, disambiguating duplicates with the parent folder", () => {
    const labels = optionLabels(["/Users/me/Projects/flow", "/Users/me/.codex/worktrees/347a/flow", "/Users/me/Projects/app"]);
    expect([...labels.values()]).toEqual(["Projects/flow", "347a/flow", "app"]);
  });
});

describe("scratchDir", () => {
  it("mirrors the desktop app's ~/Documents/Codex/<date>/<slug> layout", () => {
    const now = new Date("2026-09-19T01:02:03Z");
    expect(scratchDir("/Users/me", "Say hi in three words.", now)).toBe("/Users/me/Documents/Codex/2026-09-19/say-hi-in-three-words");
    expect(scratchDir("/Users/me/", "", now)).toBe("/Users/me/Documents/Codex/2026-09-19/new-chat");
    expect(scratchDir("/Users/me", "统计 Partner API 分类数量", now)).toBe("/Users/me/Documents/Codex/2026-09-19/partner-api");
  });
});
