import { useState } from "react";
import type { v2 } from "@codex-pocket/protocol";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { navigate } from "./route.js";

const APPROVALS: { value: "untrusted" | "on-request" | "never"; label: string }[] = [
  { value: "untrusted", label: "Ask" },
  { value: "on-request", label: "On request" },
  { value: "never", label: "Never" },
];

const SANDBOXES: { value: v2.SandboxMode; label: string }[] = [
  { value: "read-only", label: "Read-only" },
  { value: "workspace-write", label: "Workspace" },
  { value: "danger-full-access", label: "Full access" },
];

// "⋯" in the thread topbar: rename / fork / review / archive plus the
// approval + sandbox policy for upcoming turns.
export function ThreadMenu({ session }: { session: Session }) {
  const open = useStore(session.store, (s) => s.open);
  const [sheet, setSheet] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const threadId = open.view.threadId;
  const ready = open.state === "ready";
  const perms = open.permissionOverride ?? open.permissions;
  const isGranular = typeof perms?.approval === "object";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSheet(false);
      setRenaming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="icon-btn" aria-label="Thread menu" onClick={() => setSheet(true)}>
        ⋯
      </button>
      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet thread-menu" onClick={(e) => e.stopPropagation()}>
            <h2>Thread</h2>
            {error && <p className="error">{error}</p>}

            {renaming !== null ? (
              <form
                className="rename-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => session.renameThread(threadId, renaming));
                }}
              >
                <input autoFocus value={renaming} placeholder="Thread name" onChange={(e) => setRenaming(e.target.value)} />
                <button className="primary" type="submit" disabled={busy || !renaming.trim()}>
                  Save
                </button>
              </form>
            ) : (
              <ul className="menu-list">
                <li>
                  <button onClick={() => setRenaming("")}>Rename</button>
                </li>
                <li>
                  <button disabled={busy || !ready} onClick={() => void run(async () => navigate({ name: "thread", id: await session.forkThread(threadId) }))}>
                    Fork into a new thread
                  </button>
                </li>
                <li>
                  <button disabled={busy || !ready || open.view.activeTurnId !== null} onClick={() => void run(() => session.startReview())}>
                    Review uncommitted changes
                  </button>
                </li>
                <li>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Archive this thread?")) void run(async () => {
                        await session.archiveThread(threadId);
                        navigate({ name: "list" });
                      });
                    }}
                  >
                    Archive
                  </button>
                </li>
              </ul>
            )}

            <h3>Permissions for next turns</h3>
            {isGranular && <p className="muted small">This thread uses a custom approval policy; picking one below replaces it.</p>}
            <div className="segmented" role="radiogroup" aria-label="Approval policy">
              {APPROVALS.map((a) => (
                <button
                  key={a.value}
                  className={perms?.approval === a.value ? "active" : ""}
                  disabled={!ready}
                  onClick={() => session.setPermissions(a.value, perms?.sandbox ?? "workspace-write")}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className="segmented" role="radiogroup" aria-label="Sandbox">
              {SANDBOXES.map((s) => (
                <button
                  key={s.value}
                  className={perms?.sandbox === s.value ? "active" : ""}
                  disabled={!ready}
                  onClick={() => session.setPermissions(perms?.approval ?? "on-request", s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {open.permissionOverride && <p className="muted small">Applies when you send the next message.</p>}
          </div>
        </div>
      )}
    </>
  );
}
