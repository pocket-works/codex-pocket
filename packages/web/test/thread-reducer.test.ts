import { describe, expect, it } from "vitest";
import {
  applyNotification,
  applyServerRequest,
  dismissAlert,
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

describe("turn plan, token usage and alerts", () => {
  it("replaces the plan on every update and clears it on the next turn", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "turn/plan/updated", params: { threadId: T, turnId: "t", explanation: null, plan: [{ step: "a", status: "completed" }, { step: "b", status: "inProgress" }] } });
    expect(s.plan?.steps.map((p) => p.step)).toEqual(["a", "b"]);
    s = applyNotification(s, { method: "turn/plan/updated", params: { threadId: T, turnId: "t", explanation: "why", plan: [{ step: "b", status: "completed" }] } });
    expect(s.plan).toEqual({ explanation: "why", steps: [{ step: "b", status: "completed" }] });
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "t2" } } });
    expect(s.plan).toBeNull();
  });

  it("tracks context usage from the last turn", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, {
      method: "thread/tokenUsage/updated",
      params: { threadId: T, turnId: "t", tokenUsage: { total: { totalTokens: 9000 }, last: { totalTokens: 4000 }, modelContextWindow: 16000 } },
    });
    expect(s.tokenUsage).toEqual({ contextTokens: 4000, contextWindow: 16000 });
  });

  it("surfaces warnings, reroutes and retrying errors as alerts and clears them on the next turn", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "warning", params: { threadId: T, message: "low disk" } });
    s = applyNotification(s, { method: "model/rerouted", params: { threadId: T, turnId: "t", fromModel: "a", toModel: "b", reason: "highRiskCyberActivity" } });
    s = applyNotification(s, { method: "error", params: { threadId: T, turnId: "t", error: { message: "429" }, willRetry: true } });
    expect(s.alerts.map((a) => [a.kind, a.message])).toEqual([
      ["warning", "low disk"],
      ["info", "Model switched from a to b (highRiskCyberActivity)"],
      ["warning", "429 — retrying"],
    ]);
    expect(s.lastTurnError).toBeNull();
    s = applyNotification(s, { method: "turn/started", params: { threadId: T, turn: { id: "t2" } } });
    expect(s.alerts).toEqual([]);
  });

  it("treats a non-retrying error as the turn error", () => {
    let s = initialThreadState(T);
    s = applyNotification(s, { method: "error", params: { threadId: T, turnId: "t", error: { message: "boom" }, willRetry: false } });
    expect(s.lastTurnError).toBe("boom");
    expect(s.alerts).toEqual([]);
  });

  it("ignores warnings for other threads and dismisses alerts by id", () => {
    let s = initialThreadState(T);
    expect(applyNotification(s, { method: "warning", params: { threadId: "other", message: "x" } })).toBe(s);
    s = applyNotification(s, { method: "warning", params: { threadId: T, message: "x" } });
    expect(dismissAlert(s, s.alerts[0].id).alerts).toEqual([]);
  });
});

describe("approvals", () => {
  it("queues user-input requests alongside approvals", () => {
    let s = initialThreadState(T);
    const questions = [{ id: "q1", header: "Pick", question: "Which?", isOther: false, isSecret: false, options: [{ label: "A", description: "" }] }];
    s = applyServerRequest(s, { id: "srv-7", method: "item/tool/requestUserInput", params: { threadId: T, turnId: "t", itemId: "i", questions, isBlocking: true, autoResolutionMs: null } });
    expect(s.approvals).toEqual([{ id: "srv-7", method: "item/tool/requestUserInput", params: expect.objectContaining({ questions }) }]);
  });

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
