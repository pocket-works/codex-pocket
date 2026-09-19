import { useState } from "react";
import type { v2 } from "@codex-pocket/protocol";
import { diffStats, parseUnifiedDiff } from "../state/diff.js";

function kindLabel(kind: v2.PatchChangeKind): string {
  if (kind.type === "update" && kind.move_path) return "rename";
  return kind.type;
}

// Relative to the project when inside it; otherwise keep the tail so the
// file name stays visible on a phone ("…/automations/sub2api/memory.md").
function shortPath(path: string, cwd?: string): string {
  if (cwd && path.startsWith(cwd + "/")) return path.slice(cwd.length + 1);
  const parts = path.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}

// One file of a patch: header with +/- counts, tap to expand the diff.
export function FileDiff({ change, cwd, open: initiallyOpen = false }: { change: v2.FileUpdateChange; cwd?: string; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const stats = diffStats(change.diff);
  return (
    <div className="file-diff">
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className={`kind ${change.kind.type}`}>{kindLabel(change.kind)}</span>
        <span className="tool-label">{shortPath(change.path, cwd)}</span>
        <span className="diff-stats">
          {stats.added > 0 && <span className="add">+{stats.added}</span>}
          {stats.removed > 0 && <span className="del">−{stats.removed}</span>}
        </span>
        <span className="chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <DiffBody diff={change.diff} />}
    </div>
  );
}

export function DiffBody({ diff }: { diff: string }) {
  const lines = parseUnifiedDiff(diff);
  if (lines.length === 0) return <p className="muted small">No diff available.</p>;
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <span key={i} className={`line ${l.kind}`}>
          <span className="no">{l.kind === "hunk" ? "" : (l.newNo ?? l.oldNo ?? "")}</span>
          <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
          {l.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
