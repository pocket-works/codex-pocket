import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "../src/ui/route.js";
import { groupByProject } from "../src/ui/ThreadList.js";
import type { ThreadSummary } from "../src/state/session.js";

const t = (id: string, cwd: string, updatedAt: number): ThreadSummary => ({ id, cwd, title: id, preview: "", updatedAt, model: null, status: "idle", branch: null });

describe("groupByProject", () => {
  it("groups by cwd and orders groups by their newest thread", () => {
    const groups = groupByProject([t("a", "/p/one", 10), t("b", "/p/two", 30), t("c", "/p/one", 20)]);
    expect(groups.map((g) => g.cwd)).toEqual(["/p/two", "/p/one"]);
    expect(groups[1].threads.map((x) => x.id)).toEqual(["a", "c"]);
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
