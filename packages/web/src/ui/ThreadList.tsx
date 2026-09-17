import { useEffect } from "react";
import type { Session, ThreadSummary } from "../state/session.js";
import { useStore } from "../state/store.js";
import { navigate } from "./route.js";

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString();
}

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export function ThreadList({ session }: { session: Session }) {
  const threads = useStore(session.store, (s) => s.threads);
  const loading = useStore(session.store, (s) => s.threadsLoading);
  const error = useStore(session.store, (s) => s.threadsError);
  const connection = useStore(session.store, (s) => s.connection);

  useEffect(() => {
    if (connection === "open") void session.loadThreads();
  }, [connection, session]);

  return (
    <main className="screen">
      <header className="topbar">
        <h1>Threads</h1>
        <div className="topbar-actions">
          <button className="icon-btn" aria-label="Refresh" onClick={() => void session.loadThreads()} disabled={loading}>
            ↻
          </button>
          <button className="primary" onClick={() => navigate({ name: "new" })}>
            New
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {threads.length === 0 && !loading && !error && <p className="muted center">No threads yet.</p>}
      <ul className="thread-list">
        {threads.map((t) => (
          <ThreadRow key={t.id} thread={t} />
        ))}
      </ul>
    </main>
  );
}

function ThreadRow({ thread }: { thread: ThreadSummary }) {
  return (
    <li>
      <button className="thread-row" onClick={() => navigate({ name: "thread", id: thread.id })}>
        <div className="thread-row-top">
          <span className="thread-project">{projectName(thread.cwd)}</span>
          {thread.status === "active" && <span className="dot active" title="Running" />}
          <span className="thread-time">{relativeTime(thread.updatedAt)}</span>
        </div>
        <div className="thread-title">{thread.title}</div>
      </button>
    </li>
  );
}
