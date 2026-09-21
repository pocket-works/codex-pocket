import { describe, expect, it } from "vitest";
import { applyNotification, initialThreadState, mergeTurns, prependHistory, type ThreadItem } from "../src/state/thread-reducer.js";
import { formatDuration, groupTurns, sameGroup, stripShellWrapper, summarizeTools, tailLines, threadChangeTotals, toolLabel, turnDurationMs } from "../src/state/turns.js";

const T = "thread-1";
const user = (id: string, text: string): ThreadItem => ({ type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] });
const agent = (id: string, text: string, phase: "commentary" | "final_answer" | null = null): ThreadItem => ({ type: "agentMessage", id, text, phase, memoryCitation: null, delivery: null, questions: null });
const cmd = (id: string, command: string): ThreadItem => ({ type: "commandExecution", id, command, aggregatedOutput: null, commandActions: [], status: "completed", exitCode: 0 } as unknown as ThreadItem);

describe("groupTurns", () => {
  it("splits history into turns with user message, work and final answer", () => {
    let s = initialThreadState(T);
    s = prependHistory(s, [
      { turnId: "t1", item: user("u1", "weather?") },
      { turnId: "t1", item: agent("a1", "Let me check.", "commentary") },
      { turnId: "t1", item: cmd("c1", "curl wttr.in") },
      { turnId: "t1", item: agent("a2", "It is sunny.", "final_answer") },
      { turnId: "t2", item: user("u2", "thanks") },
      { turnId: "t2", item: agent("a3", "You're welcome.") },
    ]);
    const groups = groupTurns(s);
    expect(groups.map((g) => g.turnId)).toEqual(["t1", "t2"]);
    expect(groups[0].userMessages.map((i) => i.id)).toEqual(["u1"]);
    expect(groups[0].work.map((i) => i.id)).toEqual(["a1", "c1"]);
    expect(groups[0].final?.id).toBe("a2");
    expect(groups[1].final?.id).toBe("a3");
    expect(groups[1].work).toEqual([]);
  });

  it("keeps a streaming turn's last message as the (provisional) final answer", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "t1", startedAt: null, completedAt: null, durationMs: null, status: "inProgress" } } });
    s = applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "t1", item: user("u1", "hi") } });
    s = applyNotification(s, { method: "item/agentMessage/delta", params: { threadId: T, turnId: "t1", itemId: "a1", delta: "Hel" } });
    const [g] = groupTurns(s);
    expect(g.inProgress).toBe(true);
    expect(g.final?.text).toBe("Hel");
    expect(g.meta?.startedAt).not.toBeNull();
  });

  it("records turn duration from turn/completed and turns/list", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "t1", startedAt: 1000, completedAt: null, durationMs: null, status: "inProgress" } } });
    s = applyNotification(s, { method: "turn/completed", params: { threadId: T, turn: { id: "t1", startedAt: 1000, completedAt: 1115, durationMs: null, status: "completed" } } });
    expect(turnDurationMs(s.turns.t1, 0)).toBe(115_000);
    s = mergeTurns(s, [{ id: "t0", status: "completed", startedAt: 10, completedAt: 46, durationMs: 36_000, items: [], itemsView: "notLoaded", error: null }]);
    expect(formatDuration(turnDurationMs(s.turns.t0, 0)!)).toBe("36s");
  });
});

describe("labels", () => {
  it("formats durations", () => {
    expect(formatDuration(36_000)).toBe("36s");
    expect(formatDuration(115_000)).toBe("1m 55s");
    expect(formatDuration(3_780_000)).toBe("1h 3m");
  });

  it("strips the shell wrapper and summarises commands", () => {
    expect(stripShellWrapper("/bin/zsh -lc 'sed -n 1,5p a.py'")).toBe("sed -n 1,5p a.py");
    expect(stripShellWrapper("ls")).toBe("ls");
    expect(toolLabel(cmd("c", "/bin/zsh -lc 'ls -la'"))).toBe("ls -la");
    const read = { ...cmd("c", "cat a.py"), commandActions: [{ type: "read", command: "cat a.py", name: "a.py", path: "/x/a.py" }] } as unknown as ThreadItem;
    expect(toolLabel(read)).toBe("Read a.py");
  });

  it("quotes the first descriptive argument of dynamic tools", () => {
    const js = { type: "dynamicToolCall", id: "d", tool: "Js", arguments: { title: "查看可用浏览器", code: "…" }, status: "completed" } as unknown as ThreadItem;
    expect(toolLabel(js)).toBe('Js "查看可用浏览器"');
  });
});

describe("summarizeTools", () => {
  const read = (id: string, name: string): ThreadItem => ({ ...cmd(id, `cat ${name}`), commandActions: [{ type: "read", command: `cat ${name}`, name, path: `/x/${name}` }] } as unknown as ThreadItem);
  const search = (id: string): ThreadItem => ({ ...cmd(id, "rg foo"), commandActions: [{ type: "search", command: "rg foo", query: "foo", path: null }] } as unknown as ThreadItem);
  const mcp = (id: string, tool: string): ThreadItem => ({ type: "mcpToolCall", id, server: "s", tool, arguments: {}, status: "completed", result: null, error: null } as unknown as ThreadItem);

  it("describes what a batch of tool calls did, like the official activity summary", () => {
    expect(summarizeTools([read("1", "a.py"), read("2", "b.py"), read("3", "a.py")])).toBe("Read 2 files");
    expect(summarizeTools([read("1", "a.py")])).toBe("Read a file");
    expect(summarizeTools([search("1"), search("2"), cmd("3", "pnpm test")])).toBe("Searched · Ran a command");
    expect(summarizeTools([cmd("1", "ls"), cmd("2", "pwd"), mcp("3", "fetch")])).toBe("Ran 2 commands · Called fetch");
    expect(summarizeTools([mcp("1", "a"), mcp("2", "b")])).toBe("Called 2 tools");
  });

  it("counts failures", () => {
    const failed = { ...cmd("1", "make"), exitCode: 2 } as unknown as ThreadItem;
    expect(summarizeTools([failed, cmd("2", "ls")])).toBe("Ran 2 commands · 1 failed");
  });
});

describe("threadChangeTotals", () => {
  const edit = (id: string, files: Record<string, string>, status = "completed"): ThreadItem =>
    ({ type: "fileChange", id, status, changes: Object.entries(files).map(([path, diff]) => ({ path, kind: { type: "update", move_path: null }, diff })) }) as unknown as ThreadItem;
  const stats = (diff: string) => ({ added: (diff.match(/^\+/gm) ?? []).length, removed: (diff.match(/^-/gm) ?? []).length });

  it("counts unique files with the latest patch of each, skipping failed edits", () => {
    let s = initialThreadState(T);
    s = prependHistory(s, [
      { turnId: "t1", item: edit("e1", { "/p/a.ts": "+1\n+2", "/p/b.ts": "-1" }) },
      { turnId: "t2", item: edit("e2", { "/p/a.ts": "+1" }) },
      { turnId: "t2", item: edit("e3", { "/p/c.ts": "+9" }, "failed") },
    ]);
    expect(threadChangeTotals(s, stats)).toEqual({ files: 2, added: 1, removed: 1 });
  });
});

describe("stripDirectives", () => {
  it("drops ::inbox-item lines and keeps the answer", async () => {
    const { stripDirectives } = await import("../src/state/turns.js");
    expect(stripDirectives('Done.\n\n::inbox-item{title="x" summary="y"}\n')).toBe("Done.");
  });
});

describe("sameGroup", () => {
  const started = (s: ReturnType<typeof initialThreadState>, id: string, item: ThreadItem) =>
    applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "t1", item } });

  it("treats a turn whose items are untouched as unchanged across store updates", () => {
    let s = initialThreadState(T);
    s = started(s, "t1", user("u1", "hi"));
    s = started(s, "t1", agent("m1", "done"));
    const before = groupTurns(s)[0];
    // A later delta in another turn leaves this turn's items as they were.
    s = applyNotification(s, { method: "item/agentMessage/delta", params: { threadId: T, turnId: "t2", itemId: "m2", delta: "x" } });
    expect(sameGroup(before, groupTurns(s)[0])).toBe(true);
  });

  it("notices a delta to one of the turn's own items", () => {
    let s = initialThreadState(T);
    s = started(s, "t1", user("u1", "hi"));
    s = started(s, "t1", agent("m1", "par"));
    const before = groupTurns(s)[0];
    s = applyNotification(s, { method: "item/agentMessage/delta", params: { threadId: T, turnId: "t1", itemId: "m1", delta: "tial" } });
    expect(sameGroup(before, groupTurns(s)[0])).toBe(false);
  });
});

describe("tailLines", () => {
  it("returns short output whole", () => {
    expect(tailLines("a\nb", 5)).toEqual({ tail: "a\nb", hidden: 0 });
  });

  it("keeps the last lines and counts the rest", () => {
    expect(tailLines("1\n2\n3\n4\n5", 2)).toEqual({ tail: "4\n5", hidden: 3 });
  });
});

describe("review turns, whose ids disagree", () => {
  // Codex answers review/start with turn A, sends turn/started for turn B,
  // and files the review's items under A.
  it("shows the newest group as live while a turn is active under another id", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "A", item: user("u1", "Review the changes") } });
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "B", status: "inProgress" } } });
    const groups = groupTurns(s);
    expect(groups).toHaveLength(1);
    expect(groups[0].inProgress).toBe(true);
  });

  it("is idle again once any turn completes", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "B", status: "inProgress" } } });
    s = applyNotification(s, { method: "turn/completed", params: { threadId: T, turn: { id: "A", status: "interrupted" } } });
    expect(s.activeTurnId).toBeNull();
  });

  it("does not resurrect a finished turn as live", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "A", status: "inProgress" } } });
    s = applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "A", item: user("u1", "hi") } });
    s = applyNotification(s, { method: "turn/completed", params: { threadId: T, turn: { id: "A", status: "completed" } } });
    s = { ...s, activeTurnId: "C" };
    expect(groupTurns(s)[0].inProgress).toBe(false);
  });
});
