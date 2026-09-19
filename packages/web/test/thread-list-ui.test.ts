import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "../src/ui/route.js";
import { groupByProject, isScratchThread } from "../src/ui/ThreadList.js";
import { optionLabels, scratchDir } from "../src/ui/NewThread.js";
import type { ThreadSummary } from "../src/state/session.js";

const t = (id: string, cwd: string, updatedAt: number): ThreadSummary => ({ id, cwd, title: id, preview: "", updatedAt, model: null, status: "idle", branch: null });

describe("groupByProject", () => {
  it("groups by cwd, newest group and newest thread first", () => {
    const groups = groupByProject([t("a", "/p/one", 10), t("b", "/p/two", 30), t("c", "/p/one", 20)]);
    expect(groups.map((g) => g.cwd)).toEqual(["/p/two", "/p/one"]);
    expect(groups[1].threads.map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("folds ~/.codex/worktrees checkouts into the project with the same name", () => {
    const groups = groupByProject([
      t("a", "/Users/me/Projects/flow", 10),
      t("b", "/Users/me/.codex/worktrees/347a/flow", 30),
      t("c", "/Users/me/.codex/worktrees/05bc/flow", 20),
      t("d", "/Users/me/.codex/worktrees/9f00/orphan", 5),
    ]);
    expect(groups.map((g) => g.cwd)).toEqual(["/Users/me/Projects/flow", "/Users/me/.codex/worktrees/9f00/orphan"]);
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
