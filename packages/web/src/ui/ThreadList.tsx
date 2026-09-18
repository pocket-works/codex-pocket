import { useEffect, useMemo, useState } from "react";
import { getListView, setListView, type ListView } from "../state/list-prefs.js";
import type { Session, ThreadSummary } from "../state/session.js";
import { useStore } from "../state/store.js";
import { ComposeIcon, FolderIcon, SearchIcon } from "./icons.js";
import { ListMenu } from "./ListMenu.js";
import { navigate } from "./route.js";

const RECENT_CHATS = 6;

export function relativeTime(ms: number): string {
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

export function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

interface ProjectGroup {
  cwd: string;
  threads: ThreadSummary[];
  updatedAt: number;
}

export function groupByProject(threads: ThreadSummary[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const t of threads) {
    const g = groups.get(t.cwd);
    if (g) {
      g.threads.push(t);
      g.updatedAt = Math.max(g.updatedAt, t.updatedAt);
    } else groups.set(t.cwd, { cwd: t.cwd, threads: [t], updatedAt: t.updatedAt });
  }
  return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function ThreadList({ session }: { session: Session }) {
  const threads = useStore(session.store, (s) => s.threads);
  const loading = useStore(session.store, (s) => s.threadsLoading);
  const error = useStore(session.store, (s) => s.threadsError);
  const connection = useStore(session.store, (s) => s.connection);
  const [view, setView] = useState<ListView>(getListView);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (connection === "open") void session.loadThreads();
  }, [connection, session]);

  function changeView(v: ListView) {
    setListView(v);
    setView(v);
  }

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? threads.filter((t) => t.title.toLowerCase().includes(q) || projectName(t.cwd).toLowerCase().includes(q)) : threads),
    [threads, q],
  );
  const groups = useMemo(() => groupByProject(filtered), [filtered]);
  const grouped = view === "project" && !q;

  return (
    <main className="screen list">
      <header className="topbar plain">
        <h1 className="sr-only">Threads</h1>
        <span className="spacer" />
        <ListMenu session={session} view={view} onView={changeView} />
      </header>

      {error && <p className="error">{error}</p>}
      {threads.length === 0 && !loading && !error && <p className="muted center">No threads yet.</p>}

      <div className="list-scroll">
        {grouped ? (
          <>
            <h2 className="section-title">Chats</h2>
            <ul className="thread-list">
              {filtered.slice(0, RECENT_CHATS).map((t) => (
                <ThreadRow key={t.id} thread={t} showProject />
              ))}
            </ul>
            <h2 className="section-title">Projects</h2>
            <ul className="project-list">
              {groups.map((g) => (
                <li key={g.cwd}>
                  <div className="project-row">
                    <button className="project-main" aria-expanded={expanded === g.cwd} onClick={() => setExpanded((e) => (e === g.cwd ? null : g.cwd))}>
                      <span className="project-icon">
                        <FolderIcon />
                      </span>
                      <span className="project-name">{projectName(g.cwd)}</span>
                      <span className="muted small">{g.threads.length}</span>
                    </button>
                    <button className="icon-btn" aria-label={`New thread in ${projectName(g.cwd)}`} onClick={() => navigate({ name: "new", cwd: g.cwd })}>
                      <ComposeIcon />
                    </button>
                  </div>
                  {expanded === g.cwd && (
                    <ul className="thread-list nested">
                      {g.threads.map((t) => (
                        <ThreadRow key={t.id} thread={t} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="thread-list">
            {filtered.map((t) => (
              <ThreadRow key={t.id} thread={t} showProject />
            ))}
            {q && filtered.length === 0 && <p className="muted center">No matches.</p>}
          </ul>
        )}
      </div>

      <div className="list-bar">
        <label className="search-pill">
          <SearchIcon />
          <input type="search" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="primary chat-btn" onClick={() => navigate({ name: "new" })}>
          <ComposeIcon size={20} /> Chat
        </button>
      </div>
    </main>
  );
}

export function ThreadRow({ thread, showProject }: { thread: ThreadSummary; showProject?: boolean }) {
  return (
    <li>
      <button className="thread-row" onClick={() => navigate({ name: "thread", id: thread.id })}>
        <div className="thread-row-top">
          {showProject && <span className="thread-project">{projectName(thread.cwd)}</span>}
          {thread.branch && <span className="thread-branch muted">{thread.branch}</span>}
          {thread.status === "active" && <span className="dot active" title="Running" />}
          <span className="thread-time">{relativeTime(thread.updatedAt)}</span>
        </div>
        <div className="thread-title">{thread.title}</div>
      </button>
    </li>
  );
}
