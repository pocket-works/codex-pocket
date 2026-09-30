import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "../src/state/session.js";
import { applyNotification, initialThreadState, prependHistory, type ThreadItem, type ThreadViewState } from "../src/state/thread-reducer.js";
import { groupTurns } from "../src/state/turns.js";
import { Transcript } from "../src/ui/TurnView.js";

vi.mock("../src/ui/markdown.js", () => ({ renderMarkdown: (text: string) => text, handleCodeCopy: vi.fn() }));

const threadId = "thread-1";
const turnId = "turn-1";
const edit = (id: string, path = "/p/a.ts", status: Extract<ThreadItem, { type: "fileChange" }>["status"] = "completed"): ThreadItem => ({
  type: "fileChange", id, status,
  changes: [{ path, kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-old\n+new" }],
});
const message = (id: string, text: string, phase: "commentary" | "final_answer" | null = "commentary"): ThreadItem => ({
  type: "agentMessage", id, text, phase, memoryCitation: null, delivery: null, questions: null,
});
const command: ThreadItem = {
  type: "commandExecution", id: "command-1", command: "pnpm test", cwd: "/p", processId: null,
  pluginId: null, scriptPath: null, source: "agent",
  status: "inProgress", commandActions: [], aggregatedOutput: "", exitCode: null, durationMs: null,
};
const user: ThreadItem = { type: "userMessage", id: "user-2", clientId: null, content: [{ type: "text", text: "Also check the build", text_elements: [] }] };

function running(items: ThreadItem[]): ThreadViewState {
  const view = prependHistory(initialThreadState(threadId), items.map((item) => ({ turnId, item })));
  return applyNotification(view, { method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress" } } });
}

function finish(view: ThreadViewState, status: "completed" | "interrupted" | "failed" = "completed"): ThreadViewState {
  return applyNotification(view, { method: "turn/completed", params: { threadId, turn: { id: turnId, status } } });
}

function render(view: ThreadViewState): string {
  return renderToStaticMarkup(createElement(Transcript, { session: {} as Session, view, cwd: "/p" }));
}

function expectOrder(html: string, before: string, after: string): void {
  expect(html).toContain(before);
  expect(html).toContain(after);
  expect(html.indexOf(before)).toBeLessThan(html.indexOf(after));
}

describe("File Changes in the transcript", () => {
  it("retains edits separately from work for the final summary", () => {
    const change = edit("edit-1");
    const [group] = groupTurns(running([message("note-1", "Before editing"), change, message("note-2", "Checking the result"), command]));
    expect(group.work.map((item) => item.id)).toEqual(["note-1", "note-2", "command-1"]);
    expect(group.fileChanges).toEqual([change]);
  });

  it("does not show a change card while commentary and tools continue running", () => {
    const html = render(running([edit("edit-1"), message("note-1", "Checking the result"), command]));
    expectOrder(html, "Checking the result", "pnpm test");
    expect(html).not.toContain("changes-card");
    expect(html).not.toContain("a.ts");
  });

  it("does not repeat earlier edits underneath a streaming provisional final answer", () => {
    let view = running([edit("edit-1")]);
    view = applyNotification(view, { method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "answer-1", delta: "The result is" } });
    const html = render(view);
    expect(html).toContain("The result is");
    expect(html).not.toContain("changes-card");
  });

  it("does not show change cards for multiple edits during a running turn", () => {
    const html = render(running([edit("edit-1"), message("note-1", "Checking the result"), edit("edit-2", "/p/b.ts"), message("note-2", "Checking again")]));
    expectOrder(html, "Checking the result", "Checking again");
    expect(html).not.toContain("changes-card");
  });

  it("shows one summary below the answer when the turn finishes", () => {
    const html = render(finish(running([edit("edit-1"), message("note-1", "Checking the result"), edit("edit-2", "/p/b.ts"), message("answer-1", "All done", "final_answer")])));
    expectOrder(html, "All done", "2 files changed");
    expect(html).toContain("a.ts");
    expect(html).toContain("b.ts");
    expect(html.match(/class="changes-card/g)).toHaveLength(1);
  });

  it.each(["interrupted", "failed"] as const)("retains a summary when %s without a final answer", (status) => {
    const html = render(finish(running([edit("edit-1"), message("note-1", "Checking the result")]), status));
    expectOrder(html, "Checking the result", "a.ts");
    expect(html.match(/class="changes-card/g)).toHaveLength(1);
  });

  it.each([null, "commentary"] as const)("hides continued segment changes while running with message phase %s", (phase) => {
    const view = running([edit("edit-1"), message("answer-1", "First result", phase), user, message("note-1", "Checking the build")]);
    const html = render(view);
    expect(html.match(/class="changes-card/g) ?? []).toHaveLength(0);
    expect(html).toContain("Checking the build");
    const [continued] = groupTurns(view);
    expect(continued.continued).toBe(true);
    expect(continued.fileChanges.map((item) => item.id)).toEqual(["edit-1"]);
  });

  it("shows changes from a continued segment once the entire turn finishes", () => {
    const html = render(finish(running([edit("edit-1"), message("answer-1", "First result", null), user, message("answer-2", "All done", "final_answer")])));
    expectOrder(html, "First result", "a.ts");
    expectOrder(html, "a.ts", "All done");
    expect(html.match(/class="changes-card/g)).toHaveLength(1);
  });

  it("waits for turn completion even when a final answer item is already available", () => {
    const html = render(running([edit("edit-1"), message("answer-1", "All done", "final_answer")]));
    expect(html).toContain("All done");
    expect(html).not.toContain("changes-card");
  });

  it("keeps historical changes accessible when turn metadata is unavailable", () => {
    const view = prependHistory(initialThreadState(threadId), [edit("edit-1"), message("answer-1", "All done", "final_answer")].map((item) => ({ turnId, item })));
    const html = render(view);
    expectOrder(html, "All done", "a.ts");
    expect(html.match(/class="changes-card/g)).toHaveLength(1);
  });

  it("hides changes when a review's active turn id differs from its item turn id", () => {
    const view = prependHistory(initialThreadState(threadId), [edit("edit-1"), message("note-1", "Reviewing the result")].map((item) => ({ turnId, item })));
    const started = applyNotification(view, { method: "turn/started", params: { threadId, turn: { id: "review-turn", status: "inProgress" } } });
    expect(render(started)).not.toContain("changes-card");
    expect(render(finish(started))).toContain("changes-card");
  });

  it.each(["failed", "declined"] as const)("preserves the %s edit status in the completed summary", (status) => {
    const view = running([edit("edit-1", "/p/a.ts", status), message("answer-1", "Could not apply the edit", "final_answer")]);
    expect(render(view)).not.toContain("changes-card");
    const html = render(finish(view));
    expect(html).toContain('class="changes-card failed"');
    expect(html).toContain(`class="pill failed">${status}`);
    expect(html).toContain("a.ts");
  });

  it("leaves an earlier turn's summary above the output of a new running turn", () => {
    let view = finish(running([edit("edit-1"), message("answer-1", "All done", "final_answer")]));
    view = applyNotification(view, { method: "turn/started", params: { threadId, turn: { id: "turn-2", status: "inProgress" } } });
    view = applyNotification(view, { method: "item/started", params: { threadId, turnId: "turn-2", item: message("note-2", "Starting the next task") } });
    const html = render(view);
    expectOrder(html, "All done", "a.ts");
    expectOrder(html, "a.ts", "Starting the next task");
    expect(html.match(/class="changes-card/g)).toHaveLength(1);
    expect(groupTurns(view)[1].fileChanges).toEqual([]);
  });
});
