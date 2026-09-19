import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, diffStats, splitGitDiff } from "../src/state/diff.js";

const sample = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export {};
`;

describe("parseUnifiedDiff", () => {
  it("classifies lines and skips file headers", () => {
    const lines = parseUnifiedDiff(sample);
    expect(lines.map((l) => l.kind)).toEqual(["hunk", "context", "del", "add", "add", "context"]);
    expect(lines[2]).toEqual({ kind: "del", text: "const b = 2;", oldNo: 2, newNo: null });
    expect(lines[3]).toEqual({ kind: "add", text: "const b = 3;", oldNo: null, newNo: 2 });
    expect(lines[5]).toEqual({ kind: "context", text: "export {};", oldNo: 3, newNo: 4 });
  });

  it("handles a bare patch without hunk headers as added lines", () => {
    const lines = parseUnifiedDiff("hello\nworld");
    expect(lines.map((l) => l.kind)).toEqual(["add", "add"]);
  });

  it("ignores the no-newline marker", () => {
    const lines = parseUnifiedDiff("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n");
    expect(lines.map((l) => l.text)).toEqual(["@@ -1 +1 @@", "a", "b"]);
  });
});

describe("diffStats", () => {
  it("counts additions and deletions", () => {
    expect(diffStats(sample)).toEqual({ added: 2, removed: 1 });
  });
});

describe("splitGitDiff", () => {
  const text = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
    "diff --git a/new.md b/new.md",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/new.md",
    "@@ -0,0 +1 @@",
    "+hello",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "diff --git a/old-name.ts b/new-name.ts",
    "similarity index 90%",
    "rename from old-name.ts",
    "rename to new-name.ts",
    "--- a/old-name.ts",
    "+++ b/new-name.ts",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "",
  ].join("\n");

  it("splits a multi-file git diff into per-file changes with kinds", () => {
    const files = splitGitDiff(text, "/proj");
    expect(files.map((f) => [f.path, f.kind])).toEqual([
      ["/proj/src/a.ts", { type: "update", move_path: null }],
      ["/proj/new.md", { type: "add" }],
      ["/proj/gone.txt", { type: "delete" }],
      ["/proj/new-name.ts", { type: "update", move_path: "/proj/old-name.ts" }],
    ]);
    expect(diffStats(files[0].diff)).toEqual({ added: 1, removed: 1 });
    expect(files[1].diff).toContain("+hello");
  });

  it("returns nothing for an empty diff", () => {
    expect(splitGitDiff("", "/proj")).toEqual([]);
  });
});
