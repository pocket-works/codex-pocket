import { useEffect, useState } from "react";
import type { Session, ThreadSummary } from "../state/session.js";
import { ArchiveIcon } from "./icons.js";
import { navigate } from "./route.js";
import { projectName, relativeTime, useMinuteTick } from "./ThreadList.js";
import { friendlyError } from "../state/errors.js";

export function ArchivedList({ session }: { session: Session }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useMinuteTick();

  useEffect(() => {
    session
      .loadArchivedThreads()
      .then(setThreads)
      .catch((err: unknown) => setError(friendlyError(err)));
  }, [session]);

  async function restore(t: ThreadSummary) {
    setBusy(t.id);
    try {
      await session.unarchiveThread(t.id);
      setThreads((list) => list?.filter((x) => x.id !== t.id) ?? null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <h1>Archived threads</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {threads === null && !error && <p className="muted center">Loading…</p>}
      {threads?.length === 0 && (
        <p className="muted center empty">
          <ArchiveIcon /> Nothing archived.
        </p>
      )}
      <ul className="thread-list">
        {threads?.map((t) => (
          <li key={t.id} className="archived-row">
            <button className="thread-row" onClick={() => navigate({ name: "thread", id: t.id })}>
              <div className="thread-row-body">
                <div className="thread-project">{projectName(t.cwd)}</div>
                <div className="thread-title">{t.title}</div>
              </div>
              <span className="thread-time muted">{relativeTime(t.updatedAt)}</span>
            </button>
            <button className="subtle-btn" disabled={busy === t.id} onClick={() => void restore(t)}>
              {busy === t.id ? "…" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
