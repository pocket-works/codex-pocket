import type { v2 } from "@codex-pocket/protocol";
import { diffStats, splitGitDiff } from "./diff.js";
import type { Session } from "./session.js";

export interface WorkspaceChanges {
  cwd: string;
  files: v2.FileUpdateChange[];
  branch: string;
  upstream: string | null;
  totals: { files: number; added: number; removed: number };
}

export async function loadWorkspaceChanges(session: Pick<Session, "gitChanges">, cwd: string, mode: "uncommitted" | "branch"): Promise<WorkspaceChanges> {
  const result = await session.gitChanges(cwd, mode);
  const files = splitGitDiff(result.diff, cwd);
  const totals = files.reduce((sum, file) => {
    const stats = diffStats(file.diff);
    return { files: sum.files + 1, added: sum.added + stats.added, removed: sum.removed + stats.removed };
  }, { files: 0, added: 0, removed: 0 });
  return { cwd, files, branch: result.branch, upstream: result.upstream, totals };
}

export function createWorkspaceChangesReader(session: Pick<Session, "gitChanges">, cwd: string, onChange: (changes: WorkspaceChanges | null) => void) {
  let revision = 0;
  let disposed = false;
  return {
    async refresh(): Promise<void> {
      if (disposed) return;
      const request = ++revision;
      try {
        const changes = await loadWorkspaceChanges(session, cwd, "uncommitted");
        if (!disposed && request === revision) onChange(changes);
      } catch {
        if (!disposed && request === revision) onChange(null);
      }
    },
    accept(changes: WorkspaceChanges): void {
      if (disposed || changes.cwd !== cwd) return;
      revision++;
      onChange(changes);
    },
    dispose(): void {
      disposed = true;
      revision++;
    },
  };
}
