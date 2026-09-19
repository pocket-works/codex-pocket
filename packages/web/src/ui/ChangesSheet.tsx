import type { ThreadViewState } from "../state/thread-reducer.js";
import { threadChanges } from "../state/turns.js";
import { FileDiff } from "./DiffView.js";

// Every file the thread has edited so far, latest version of each diff.
export function ChangesSheet({ view, cwd, onClose }: { view: ThreadViewState; cwd: string; onClose: () => void }) {
  const changes = threadChanges(view);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2>Changes</h2>
        {changes.length === 0 ? (
          <p className="muted center">No files changed in this thread.</p>
        ) : (
          <>
            <p className="muted small">
              {changes.length} file{changes.length === 1 ? "" : "s"} changed
            </p>
            {changes.map((c) => (
              <FileDiff key={c.path} change={c} cwd={cwd} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
