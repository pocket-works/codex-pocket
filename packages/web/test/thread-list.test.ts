import { describe, expect, it } from "vitest";
import type { v2 } from "@codex-pocket/protocol";
import { applyThreadListNotification, canAcceptInput, isSubagent, mergeThreadList, subagentsForParent, summarize, withFirstMessage } from "../src/state/thread-list.js";

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
  it("retains subagent ownership and input capability, including older source metadata", () => {
    const child = summarize(thread("child", 1, {
      source: { subAgent: { thread_spawn: { parent_thread_id: "parent", depth: 1, agent_path: null, agent_nickname: "Audit", agent_role: "reviewer" } } },
      canAcceptDirectInput: false,
    }));
    expect(child).toMatchObject({ parentThreadId: "parent", agentNickname: "Audit", agentRole: "reviewer", canAcceptDirectInput: false });
    expect(isSubagent(child)).toBe(true);
    expect(canAcceptInput(child)).toBe(false);
    expect(canAcceptInput({ parentThreadId: "parent", canAcceptDirectInput: null })).toBe(false);
    expect(canAcceptInput({ parentThreadId: "parent", canAcceptDirectInput: true })).toBe(true);
    expect(canAcceptInput({})).toBe(true);
  });

  it("selects descendants without mixing siblings, forks or cyclic parent links", () => {
    const threads = mergeThreadList([], [
      thread("parent", 1), thread("child", 2, { parentThreadId: "parent" }),
      thread("nested", 3, { parentThreadId: "child" }), thread("other", 4, { parentThreadId: "different" }),
      thread("fork", 5, { forkedFromId: "parent" }), thread("cycle", 6, { parentThreadId: "cycle" }),
    ]);
    expect(subagentsForParent(threads, "parent").map((t) => t.id)).toEqual(["nested", "child"]);
    expect(isSubagent(threads.find((t) => t.id === "fork")!)).toBe(false);
  });
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

  it("maps active with no flags to running and bumps it to the top", () => {
    const out = applyThreadListNotification(base, { method: "thread/status/changed", params: { threadId: "a", status: { type: "active" } } }, 50_000);
    expect(out[0]).toMatchObject({ id: "a", status: "running", waitingFor: null, updatedAt: 50_000 });
  });

  it("splits waitingOnApproval and waitingOnUserInput out of active", () => {
    const approved = applyThreadListNotification(base, {
      method: "thread/status/changed",
      params: { threadId: "a", status: { type: "active", activeFlags: ["waitingOnApproval"] } },
    }, 1);
    expect(approved.find((t) => t.id === "a")).toMatchObject({ status: "waiting", waitingFor: "approval" });

    const input = applyThreadListNotification(base, {
      method: "thread/status/changed",
      params: { threadId: "a", status: { type: "active", activeFlags: ["waitingOnUserInput"] } },
    }, 1);
    expect(input.find((t) => t.id === "a")).toMatchObject({ status: "waiting", waitingFor: "input" });
  });

  it("keeps systemError visible instead of folding it into unknown", () => {
    const out = applyThreadListNotification(base, { method: "thread/status/changed", params: { threadId: "a", status: { type: "systemError" } } }, 1);
    expect(out.find((t) => t.id === "a")?.status).toBe("error");
  });

  it("floats a thread blocked on approval to the top too", () => {
    const out = applyThreadListNotification(base, {
      method: "thread/status/changed",
      params: { threadId: "a", status: { type: "active", activeFlags: ["waitingOnApproval"] } },
    }, 50_000);
    expect(out[0]).toMatchObject({ id: "a", status: "waiting", updatedAt: 50_000 });
  });

  it("marks a finished turn unread, then clears it when the next turn starts", () => {
    const done = applyThreadListNotification(base, {
      method: "turn/completed",
      params: { threadId: "a", turn: { id: "t1", status: "completed" } },
    }, 1);
    expect(done.find((t) => t.id === "a")?.unread).toBe(true);
    expect(done.find((t) => t.id === "b")?.unread).toBe(false);

    const next = applyThreadListNotification(done, { method: "turn/started", params: { threadId: "a", turn: { id: "t2" } } }, 2);
    expect(next.find((t) => t.id === "a")?.unread).toBe(false);
  });

  it("leaves failed and interrupted turns unflagged: the error path speaks for itself", () => {
    for (const status of ["failed", "interrupted"]) {
      const out = applyThreadListNotification(base, { method: "turn/completed", params: { threadId: "a", turn: { id: "t1", status } } }, 1);
      expect(out.find((t) => t.id === "a")?.unread).toBe(false);
    }
  });

  it("carries unread across a thread/list refresh, which cannot report it", () => {
    const done = applyThreadListNotification(base, { method: "turn/completed", params: { threadId: "a", turn: { id: "t1", status: "completed" } } }, 1);
    const refreshed = mergeThreadList(done, [thread("a", 5), thread("b", 9)]);
    expect(refreshed.find((t) => t.id === "a")?.unread).toBe(true);
    expect(refreshed.find((t) => t.id === "b")?.unread).toBe(false);
  });

  it("returns the same array when nothing changed", () => {
    expect(applyThreadListNotification(base, { method: "thread/name/updated", params: { threadId: "zzz", threadName: "x" } }, 0)).toBe(base);
    expect(applyThreadListNotification(base, { method: "turn/started", params: { threadId: "a" } }, 0)).toBe(base);
  });
});

describe("a nameless thread's first message", () => {
  const fresh = () => [summarize(thread("new", 1, { preview: "", name: null }))];
  const text = (t: string) => [{ type: "text" as const, text: t, text_elements: [] }];

  it("titles the thread instead of leaving it untitled", () => {
    expect(fresh()[0].title).toBe("(untitled)");
    const list = withFirstMessage(fresh(), "new", text("  extract the\n audio  "));
    expect(list[0]).toMatchObject({ title: "extract the audio", preview: "extract the audio" });
  });

  it("arrives through the item echo too, and only the first message counts", () => {
    const echo = (t: string) => ({
      jsonrpc: "2.0" as const,
      method: "item/started",
      params: { threadId: "new", turnId: "turn-1", item: { type: "userMessage", id: "u1", content: text(t) } },
    });
    let list = applyThreadListNotification(fresh(), echo("first"), 0);
    expect(list[0].title).toBe("first");
    list = applyThreadListNotification(list, echo("second"), 0);
    expect(list[0].title).toBe("first");
  });

  it("leaves a named thread's title alone, and ignores a message with no text", () => {
    const named = [summarize(thread("n", 1, { preview: "", name: "Named by Codex" }))];
    expect(withFirstMessage(named, "n", text("hello"))[0].title).toBe("Named by Codex");
    expect(withFirstMessage(fresh(), "new", [])[0].title).toBe("(untitled)");
  });
});
