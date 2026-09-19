import type { v2 } from "@codex-pocket/protocol";

export type DiffLineKind = "hunk" | "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Pure: unified diff text -> lines with numbers. Tolerant of patches that
// lack headers (Codex sometimes sends the added file body for new files).
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  let inHunk = false;
  const raw = diff.split("\n");
  if (raw[raw.length - 1] === "") raw.pop();
  for (const line of raw) {
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff ") || line.startsWith("index ")) continue;
    if (line.startsWith("\\")) continue;
    const hunk = HUNK.exec(line);
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      out.push({ kind: "hunk", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk) {
      out.push({ kind: "add", text: line, oldNo: null, newNo: newNo++ });
      continue;
    }
    const mark = line[0];
    const text = line.slice(1);
    if (mark === "+") out.push({ kind: "add", text, oldNo: null, newNo: newNo++ });
    else if (mark === "-") out.push({ kind: "del", text, oldNo: oldNo++, newNo: null });
    else out.push({ kind: "context", text, oldNo: oldNo++, newNo: newNo++ });
  }
  return out;
}

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of parseUnifiedDiff(diff)) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/**
 * `git diff` output → one entry per file, in the shape Codex uses for its
 * own patches so the same diff view renders both. Paths are made absolute
 * under `root`.
 */
export function splitGitDiff(text: string, root: string): v2.FileUpdateChange[] {
  const out: v2.FileUpdateChange[] = [];
  const abs = (p: string) => `${root.replace(/\/$/, "")}/${p}`;
  const chunks = text.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "));
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const head = /^diff --git a\/(.*) b\/(.*)$/.exec(lines[0]);
    if (!head) continue;
    let kind: v2.PatchChangeKind = { type: "update", move_path: null };
    let path = head[2];
    for (const line of lines.slice(1, 8)) {
      if (line.startsWith("new file mode")) kind = { type: "add" };
      else if (line.startsWith("deleted file mode")) kind = { type: "delete" };
      else if (line.startsWith("rename to ")) {
        path = line.slice("rename to ".length);
        kind = { type: "update", move_path: abs(head[1]) };
      }
    }
    const body = lines.findIndex((l) => l.startsWith("@@"));
    out.push({ path: abs(path), kind, diff: body < 0 ? "" : lines.slice(body).join("\n") });
  }
  return out;
}
