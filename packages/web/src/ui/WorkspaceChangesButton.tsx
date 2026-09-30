import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import type { ThreadViewState } from "../state/thread-reducer.js";
import { createWorkspaceChangesReader, type WorkspaceChanges } from "../state/workspace-changes.js";
import { WorkspaceSheet } from "./WorkspaceSheet.js";

export function WorkspaceChangesButton({ session, cwd, view, connected }: { session: Session; cwd: string; view: ThreadViewState; connected: boolean }) {
  const [changes, setChanges] = useState<WorkspaceChanges | null>(null);
  const [open, setOpen] = useState(false);
  const reader = useRef<ReturnType<typeof createWorkspaceChangesReader> | null>(null);
  const revision = `${view.activeTurnId ?? ""}:${view.items.filter((item) => "status" in item).map((item) => `${item.id}:${"status" in item ? item.status : ""}`).join("|")}`;

  useEffect(() => {
    if (!cwd || !connected) {
      setChanges(null);
      return;
    }
    const current = createWorkspaceChangesReader(session, cwd, setChanges);
    reader.current = current;
    const refresh = () => {
      if (document.visibilityState !== "hidden") void current.refresh();
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current.dispose();
      reader.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session, cwd, connected]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "hidden") void reader.current?.refresh();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [session, cwd, connected, revision]);

  const acceptChanges = useCallback((snapshot: WorkspaceChanges) => reader.current?.accept(snapshot), []);
  const totals = connected && changes?.cwd === cwd ? changes.totals : null;
  return (
    <>
      {totals && totals.files > 0 && (
        <div className="changes-pill-row">
          <button className="changes-pill" onClick={() => setOpen(true)} aria-label="Show changes">
            <span>{totals.files} file{totals.files === 1 ? "" : "s"}</span>
            <span className="diff-stats">
              <span className="add">+{totals.added}</span> <span className="del">−{totals.removed}</span>
            </span>
          </button>
        </div>
      )}
      {open && <WorkspaceSheet session={session} cwd={cwd} initialTab="modified" onClose={() => setOpen(false)} onUncommittedChanges={acceptChanges} />}
    </>
  );
}
