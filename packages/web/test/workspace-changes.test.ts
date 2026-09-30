import { describe, expect, it, vi } from "vitest";
import type { Session } from "../src/state/session.js";
import { createWorkspaceChangesReader, loadWorkspaceChanges, type WorkspaceChanges } from "../src/state/workspace-changes.js";

type GitChanges = Awaited<ReturnType<Session["gitChanges"]>>;
const cwd = "/project";
const result = (diff = ""): GitChanges => ({ diff, branch: "main", upstream: "origin/main" });
const patch = [
  "diff --git a/a.ts b/a.ts",
  "index 1111111..2222222 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1,2 @@",
  "-old",
  "+new",
  "+extra",
  "diff --git a/new.txt b/new.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/new.txt",
  "@@ -0,0 +1 @@",
  "+hello",
  "",
].join("\n");

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

describe("loadWorkspaceChanges", () => {
  it("counts exactly the files and lines shown by the current Git diff", async () => {
    const session = { gitChanges: vi.fn().mockResolvedValue(result(patch)) };
    const changes = await loadWorkspaceChanges(session, cwd, "uncommitted");
    expect(session.gitChanges).toHaveBeenCalledWith(cwd, "uncommitted");
    expect(changes.files.map((file) => file.path)).toEqual(["/project/a.ts", "/project/new.txt"]);
    expect(changes.totals).toEqual({ files: 2, added: 3, removed: 1 });
    expect(changes).toMatchObject({ cwd, branch: "main", upstream: "origin/main" });
  });

  it("clears counts after files are committed or reverted", async () => {
    const session = { gitChanges: vi.fn().mockResolvedValueOnce(result(patch)).mockResolvedValueOnce(result()) };
    expect((await loadWorkspaceChanges(session, cwd, "uncommitted")).totals.files).toBe(2);
    const clean = await loadWorkspaceChanges(session, cwd, "uncommitted");
    expect(clean.files).toEqual([]);
    expect(clean.totals).toEqual({ files: 0, added: 0, removed: 0 });
  });

  it("keeps branch mode separate from uncommitted mode", async () => {
    const session = { gitChanges: vi.fn().mockResolvedValue(result(patch)) };
    await loadWorkspaceChanges(session, cwd, "branch");
    expect(session.gitChanges).toHaveBeenCalledWith(cwd, "branch");
  });

  it("counts a binary or mode-only change even when it has no changed lines", async () => {
    const session = { gitChanges: vi.fn().mockResolvedValue(result("diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n")) };
    expect((await loadWorkspaceChanges(session, cwd, "uncommitted")).totals).toEqual({ files: 1, added: 0, removed: 0 });
  });
});

describe("workspace changes refresh", () => {
  it("publishes the clean workspace after earlier edits", async () => {
    const session = { gitChanges: vi.fn().mockResolvedValueOnce(result(patch)).mockResolvedValueOnce(result()) };
    const onChange = vi.fn();
    const reader = createWorkspaceChangesReader(session, cwd, onChange);
    await reader.refresh();
    await reader.refresh();
    expect(onChange.mock.calls.map(([changes]) => changes.totals.files)).toEqual([2, 0]);
  });

  it("does not let an older response replace a newer clean workspace", async () => {
    const first = deferred<GitChanges>();
    const second = deferred<GitChanges>();
    const session = { gitChanges: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    const onChange = vi.fn();
    const reader = createWorkspaceChangesReader(session, cwd, onChange);
    const oldRequest = reader.refresh();
    const newRequest = reader.refresh();
    second.resolve(result());
    await newRequest;
    first.resolve(result(patch));
    await oldRequest;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].totals.files).toBe(0);
  });

  it("uses the detail sheet's snapshot without a stale background request overriding it", async () => {
    const pending = deferred<GitChanges>();
    const onChange = vi.fn();
    const reader = createWorkspaceChangesReader({ gitChanges: () => pending.promise }, cwd, onChange);
    const request = reader.refresh();
    const clean = await loadWorkspaceChanges({ gitChanges: async () => result() }, cwd, "uncommitted");
    reader.accept(clean);
    pending.resolve(result(patch));
    await request;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(clean);
  });

  it("discards pending results after leaving a workspace", async () => {
    const pending = deferred<GitChanges>();
    const onChange = vi.fn();
    const reader = createWorkspaceChangesReader({ gitChanges: () => pending.promise }, cwd, onChange);
    const request = reader.refresh();
    reader.dispose();
    pending.resolve(result(patch));
    await request;
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not query a workspace after its reader has been disposed", async () => {
    const session = { gitChanges: vi.fn().mockResolvedValue(result()) };
    const onChange = vi.fn();
    const reader = createWorkspaceChangesReader(session, cwd, onChange);
    reader.dispose();
    await reader.refresh();
    expect(session.gitChanges).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects snapshots belonging to another directory", async () => {
    const snapshot = await loadWorkspaceChanges({ gitChanges: async () => result(patch) }, "/other", "uncommitted");
    const onChange = vi.fn();
    const reader = createWorkspaceChangesReader({ gitChanges: async () => result() }, cwd, onChange);
    reader.accept(snapshot);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides outdated counts when Git becomes unavailable and recovers on refresh", async () => {
    const session = { gitChanges: vi.fn().mockResolvedValueOnce(result(patch)).mockRejectedValueOnce(new Error("not a git repository")).mockResolvedValueOnce(result()) };
    const updates: (WorkspaceChanges | null)[] = [];
    const reader = createWorkspaceChangesReader(session, cwd, (changes) => updates.push(changes));
    await reader.refresh();
    await reader.refresh();
    await reader.refresh();
    expect(updates.map((changes) => changes?.totals.files ?? null)).toEqual([2, null, 0]);
  });

  it("ignores a stale error after the sheet has supplied a valid snapshot", async () => {
    const pending = deferred<GitChanges>();
    const onChange = vi.fn();
    const reader = createWorkspaceChangesReader({ gitChanges: () => pending.promise }, cwd, onChange);
    const request = reader.refresh();
    const snapshot = await loadWorkspaceChanges({ gitChanges: async () => result(patch) }, cwd, "uncommitted");
    reader.accept(snapshot);
    pending.reject(new Error("disconnected"));
    await request;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(snapshot);
  });
});
