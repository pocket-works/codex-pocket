import { describe, expect, it } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import { applyThreadListNotification, mergeThreadList, summarize } from "../src/state/thread-list.js";

function thread(id: string, updatedAt: number, extra: Partial<v2.Thread> = {}): v2.Thread {
  return {
    id,
    cwd: "/Users/me/proj",
    preview: `preview ${id}`,
    name: null,
    model: "gpt-5",
    updatedAt,
    status: { type: "idle" },
    gitInfo: null,
    ...extra,
  } as v2.Thread;
}

describe("summarize", () => {
  it("prefers the name over the preview and picks up the git branch", () => {
    const s = summarize(thread("a", 10, { name: "  My  thread ", gitInfo: { sha: null, branch: "feat/x", originUrl: null } }));
    expect(s.title).toBe("My thread");
    expect(s.branch).toBe("feat/x");
    expect(s.updatedAt).toBe(10_000);
  });

  it("uses recencyAt for the timestamp: updatedAt also moves on a plain thread/resume", () => {
    expect(summarize(thread("a", 99, { recencyAt: 10 })).updatedAt).toBe(10_000);
    expect(summarize(thread("a", 99, { recencyAt: null })).updatedAt).toBe(99_000);
  });

  it("falls back to (untitled) when there is no text", () => {
    expect(summarize(thread("a", 1, { preview: "" })).title).toBe("(untitled)");
  });
});

describe("mergeThreadList", () => {
  it("dedupes by id and sorts newest first", () => {
    const out = mergeThreadList([], [thread("a", 5), thread("b", 9), thread("a", 5)]);
    expect(out.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("applyThreadListNotification", () => {
  const base = mergeThreadList([], [thread("a", 5), thread("b", 9)]);

  it("inserts a started thread at the top", () => {
    const out = applyThreadListNotification(base, { method: "thread/started", params: { thread: thread("c", 20) } }, 0);
    expect(out.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  it("does not duplicate a thread that started twice", () => {
    let out = applyThreadListNotification(base, { method: "thread/started", params: { thread: thread("c", 20) } }, 0);
    out = applyThreadListNotification(out, { method: "thread/started", params: { thread: thread("c", 20) } }, 0);
    expect(out.filter((t) => t.id === "c")).toHaveLength(1);
  });

  it("renames a thread in place and keeps the preview when the name is cleared", () => {
    let out = applyThreadListNotification(base, { method: "thread/name/updated", params: { threadId: "a", threadName: "Renamed" } }, 0);
    expect(out.find((t) => t.id === "a")?.title).toBe("Renamed");
    out = applyThreadListNotification(out, { method: "thread/name/updated", params: { threadId: "a" } }, 0);
    expect(out.find((t) => t.id === "a")?.title).toBe("preview a");
  });

  it("removes archived and deleted threads", () => {
    let out = applyThreadListNotification(base, { method: "thread/archived", params: { threadId: "a" } }, 0);
    out = applyThreadListNotification(out, { method: "thread/deleted", params: { threadId: "b" } }, 0);
    expect(out).toEqual([]);
  });

  it("marks a thread active and bumps it to the top", () => {
    const out = applyThreadListNotification(base, { method: "thread/status/changed", params: { threadId: "a", status: { type: "active" } } }, 50_000);
    expect(out[0]).toMatchObject({ id: "a", status: "active", updatedAt: 50_000 });
  });

  it("returns the same array when nothing changed", () => {
    expect(applyThreadListNotification(base, { method: "thread/name/updated", params: { threadId: "zzz", threadName: "x" } }, 0)).toBe(base);
    expect(applyThreadListNotification(base, { method: "turn/started", params: { threadId: "a" } }, 0)).toBe(base);
  });
});
