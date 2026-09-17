import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, diffStats } from "../src/state/diff.js";

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
