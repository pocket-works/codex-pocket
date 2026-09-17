import { describe, expect, it } from "vitest";
import {
  applyNotification,
  applyServerRequest,
  initialThreadState,
  prependHistory,
  removeApproval,
  type ThreadItem,
} from "../src/state/thread-reducer.js";

const T = "thread-1";
const agent = (id: string, text = ""): ThreadItem => ({ type: "agentMessage", id, text, phase: null, memoryCitation: null, delivery: null, questions: null });

describe("applyNotification", () => {
  it("ignores notifications for other threads", () => {
    const s = initialThreadState(T);
    expect(applyNotification(s, { method: "turn/started", params: { threadId: "other", turn: { id: "x" } } })).toBe(s);
  });

  it("tracks the active turn and its failure", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "turn-1" } } });
    expect(s.activeTurnId).toBe("turn-1");
    s = applyNotification(s, { method: "turn/completed", params: { threadId: T, turn: { id: "turn-1", status: "failed", error: { message: "quota" } } } });
    expect(s.activeTurnId).toBeNull();
    expect(s.lastTurnError).toBe("quota");
  });

  it("accumulates agent message deltas, creating a placeholder if the item was not announced", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "item/agentMessage/delta", params: { threadId: T, turnId: "t", itemId: "m1", delta: "Hel" } });
    s = applyNotification(s, { method: "item/agentMessage/delta", params: { threadId: T, turnId: "t", itemId: "m1", delta: "lo" } });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ type: "agentMessage", id: "m1", text: "Hello" });
  });

  it("replaces an item on completion without duplicating it", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "t", item: agent("m1") } });
    s = applyNotification(s, { method: "item/agentMessage/delta", params: { threadId: T, turnId: "t", itemId: "m1", delta: "partial" } });
    s = applyNotification(s, { method: "item/completed", params: { threadId: T, turnId: "t", item: agent("m1", "final text") } });
    expect(s.items).toEqual([agent("m1", "final text")]);
  });

  it("fills reasoning summaries by index", () => {
    let s = initialThreadState(T);
    const reasoning: ThreadItem = { type: "reasoning", id: "r1", summary: [], content: [] };
    s = applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "t", item: reasoning } });
    s = applyNotification(s, { method: "item/reasoning/summaryTextDelta", params: { threadId: T, turnId: "t", itemId: "r1", delta: "A", summaryIndex: 1 } });
    s = applyNotification(s, { method: "item/reasoning/summaryTextDelta", params: { threadId: T, turnId: "t", itemId: "r1", delta: "B", summaryIndex: 1 } });
    expect((s.items[0] as { summary: string[] }).summary).toEqual(["", "AB"]);
  });

  it("appends command output deltas", () => {
    let s = initialThreadState(T);
    const cmd = { type: "commandExecution", id: "c1", command: "ls", aggregatedOutput: null } as unknown as ThreadItem;
    s = applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "t", item: cmd } });
    s = applyNotification(s, { method: "item/commandExecution/outputDelta", params: { threadId: T, turnId: "t", itemId: "c1", delta: "a.txt\n" } });
    expect((s.items[0] as { aggregatedOutput: string }).aggregatedOutput).toBe("a.txt\n");
  });
});

describe("approvals", () => {
  it("collects approval requests for this thread and drops them when resolved", () => {
    let s = initialThreadState(T);
    s = applyServerRequest(s, { id: "srv-1", method: "item/commandExecution/requestApproval", params: { threadId: T, command: "rm -rf x" } });
    s = applyServerRequest(s, { id: "srv-1", method: "item/commandExecution/requestApproval", params: { threadId: T, command: "rm -rf x" } });
    s = applyServerRequest(s, { id: "srv-2", method: "item/commandExecution/requestApproval", params: { threadId: "other" } });
    s = applyServerRequest(s, { id: "srv-3", method: "item/tool/call", params: { threadId: T } });
    expect(s.approvals.map((a) => a.id)).toEqual(["srv-1"]);
    s = applyNotification(s, { method: "serverRequest/resolved", params: { threadId: T, requestId: "srv-1" } });
    expect(s.approvals).toEqual([]);
  });

  it("removes an approval once the phone answered it", () => {
    let s = initialThreadState(T);
    s = applyServerRequest(s, { id: 9, method: "item/fileChange/requestApproval", params: { threadId: T } });
    expect(removeApproval(s, 9).approvals).toEqual([]);
  });
});

describe("prependHistory", () => {
  it("puts older items first and skips ones already present", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "item/started", params: { threadId: T, turnId: "t", item: agent("m3") } });
    s = prependHistory(s, [
      { turnId: "t0", item: agent("m1") },
      { turnId: "t0", item: agent("m2") },
      { turnId: "t", item: agent("m3", "dup") },
    ]);
    expect(s.items.map((i) => i.id)).toEqual(["m1", "m2", "m3"]);
  });
});
