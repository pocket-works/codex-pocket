import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getListView, setListView, type ListView } from "../state/list-prefs.js";
import { getPins } from "../state/pins.js";
import { describe, type Session, type ThreadStatus, type ThreadSummary } from "../state/session.js";
import { useStore } from "../state/store.js";
import { ArchiveIcon, BranchIcon, CheckIcon, ComposeIcon, FolderIcon, SearchIcon } from "./icons.js";
import { ListMenu } from "./ListMenu.js";
import { navigate } from "./route.js";

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

// The desktop app starts project-less chats in a scratch dir under
// ~/Documents/Codex/<date>/<slug>; those go under "Chats", everything else under "Projects".
export function isScratchThread(t: ThreadSummary): boolean {
  return /\/Documents\/Codex\/[^/]+\/[^/]+/.test(t.cwd);
}

interface ProjectGroup {
  cwd: string;
  threads: ThreadSummary[];
  updatedAt: number;
}

// Desktop-app worktrees live at ~/.codex/worktrees/<id>/<repo>. The PWA cannot
// read their .git file, so they are folded into the project with the same name.
export function isWorktree(cwd: string): boolean {
  return /\/\.codex\/worktrees\/[^/]+\/[^/]+$/.test(cwd);
}

export function groupByProject(threads: ThreadSummary[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const add = (key: string, t: ThreadSummary) => {
    const g = groups.get(key);
    if (g) {
      g.threads.push(t);
      g.updatedAt = Math.max(g.updatedAt, t.updatedAt);
    } else groups.set(key, { cwd: key, threads: [t], updatedAt: t.updatedAt });
  };
  const worktrees: ThreadSummary[] = [];
  for (const t of threads) {
    if (isWorktree(t.cwd)) worktrees.push(t);
    else add(t.cwd, t);
  }
  for (const t of worktrees) {
    const name = projectName(t.cwd);
    const home = [...groups.keys()].find((cwd) => !isWorktree(cwd) && projectName(cwd) === name);
    add(home ?? t.cwd, t);
  }
  for (const g of groups.values()) g.threads.sort((a, b) => b.updatedAt - a.updatedAt);
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

  const archive = (id: string) => void session.archiveThread(id).catch((err) => session.notify(describe(err)));

  function changeView(v: ListView) {
    setListView(v);
    setView(v);
  }

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? threads.filter((t) => t.title.toLowerCase().includes(q) || projectName(t.cwd).toLowerCase().includes(q)) : threads),
    [threads, q],
  );
  // Pinned threads sit in their own section and nowhere else (unless searching).
  const pinIds = getPins().join(",");
  const pinned = useMemo(() => (q ? [] : pinIds.split(",").map((id) => filtered.find((t) => t.id === id)).filter((t): t is ThreadSummary => t !== undefined)), [filtered, pinIds, q]);
  const rest = useMemo(() => (pinned.length > 0 ? filtered.filter((t) => !pinned.includes(t)) : filtered), [filtered, pinned]);
  const chats = useMemo(() => rest.filter(isScratchThread), [rest]);
  const groups = useMemo(() => groupByProject(rest.filter((t) => !isScratchThread(t))), [rest]);
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
        {pinned.length > 0 && (
          <>
            <h2 className="section-title">Pinned</h2>
            <ul className="thread-list">
              {pinned.map((t) => (
                <ThreadRow key={t.id} thread={t} showProject={!isScratchThread(t)} plain onArchive={archive} />
              ))}
            </ul>
          </>
        )}
        {grouped ? (
          <>
            {chats.length > 0 && (
              <>
                <h2 className="section-title">Chats</h2>
                <ul className="thread-list">
                  {chats.map((t) => (
                    <ThreadRow key={t.id} thread={t} plain onArchive={archive} />
                  ))}
                </ul>
              </>
            )}
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
                        <ThreadRow key={t.id} thread={t} compact onArchive={archive} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="thread-list">
            {rest.map((t) => (
              <ThreadRow key={t.id} thread={t} showProject={!isScratchThread(t)} plain onArchive={archive} />
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

export function ThreadRow({
  thread,
  showProject,
  compact,
  plain,
  onArchive,
}: {
  thread: ThreadSummary;
  showProject?: boolean;
  compact?: boolean;
  /** Title and project only, like the official "Chats" section. */
  plain?: boolean;
  onArchive: (id: string) => void;
}) {
  const open = () => navigate({ name: "thread", id: thread.id });
  if (compact) {
    // Inside a project: one line, title left, time right.
    return (
      <SwipeRow onArchive={() => onArchive(thread.id)}>
        <button className="thread-row compact" onClick={open}>
          <span className="thread-title">{thread.title}</span>
          {isWorktree(thread.cwd) && (
            <span className="thread-worktree muted" title="Worktree">
              <BranchIcon size={14} />
            </span>
          )}
          <ThreadStateMark thread={thread} />
          <span className="thread-time muted">{relativeTime(thread.updatedAt)}</span>
        </button>
      </SwipeRow>
    );
  }
  return (
    <SwipeRow onArchive={() => onArchive(thread.id)}>
      <button className="thread-row" onClick={open}>
        <div className="thread-row-top">
          {showProject && <span className="thread-project">{projectName(thread.cwd)}</span>}
          <ThreadStateMark thread={thread} />
          {!plain && <span className="thread-time">{relativeTime(thread.updatedAt)}</span>}
        </div>
        <div className="thread-title">{thread.title}</div>
      </button>
    </SwipeRow>
  );
}

// Mirrors the official sidebar: a spinner while a turn runs, an amber chip
// when Codex is blocked on you, red on a system error, a green check once a
// finished turn has not been read yet. Green is never used for "busy".
const STATE_LABEL: Record<ThreadStatus, string> = {
  running: "Working",
  waiting: "Needs input",
  error: "Task encountered a system error",
  idle: "",
  unknown: "",
};

function ThreadStateMark({ thread }: { thread: ThreadSummary }) {
  const { status, unread, waitingFor } = thread;
  if (status === "running") {
    return (
      <span className="thread-state running" role="status" aria-label={STATE_LABEL.running} title={STATE_LABEL.running}>
        <span className="spinner" aria-hidden="true" />
      </span>
    );
  }
  if (status === "waiting") {
    const label = waitingFor === "approval" ? "Needs approval" : STATE_LABEL.waiting;
    return (
      <span className="thread-state waiting" role="status" aria-label={label} title={label}>
        <span className="thread-state-chip">{label}</span>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="thread-state error" role="status" aria-label={STATE_LABEL.error} title={STATE_LABEL.error}>
        <span className="dot" aria-hidden="true" />
      </span>
    );
  }
  if (unread) {
    return (
      <span className="thread-state ready" role="status" aria-label="Ready" title="Ready">
        <CheckIcon size={14} />
      </span>
    );
  }
  return null;
}

const SWIPE_REVEAL = 96;

// Swipe a row left to reveal an Archive button, as in the official app.
// Touch only: a mouse gets no hint, so desktop keeps the thread menu.
function SwipeRow({ children, onArchive }: { children: ReactNode; onArchive: () => void }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; offset: number; axis: "x" | "y" | null } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, offset, axis: null };
  }

  function onTouchMove(e: React.TouchEvent) {
    const st = start.current;
    if (!st) return;
    const t = e.touches[0];
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;
    if (!st.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (st.axis === "x") setDragging(true);
    }
    if (st.axis !== "x") return;
    setOffset(Math.max(-SWIPE_REVEAL - 20, Math.min(0, st.offset + dx)));
  }

  function onTouchEnd() {
    const st = start.current;
    start.current = null;
    setDragging(false);
    if (st?.axis === "x") setOffset((o) => (o < -SWIPE_REVEAL / 2 ? -SWIPE_REVEAL : 0));
  }

  return (
    <li className={`swipe-row ${offset < 0 ? "open" : ""}`}>
      <button
        className="swipe-action"
        tabIndex={offset < 0 ? 0 : -1}
        aria-hidden={offset === 0}
        onClick={() => {
          setOffset(0);
          onArchive();
        }}
      >
        <ArchiveIcon /> Archive
      </button>
      <div
        className={`swipe-content ${dragging ? "dragging" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(e) => {
          // A tap while revealed just closes the row.
          if (offset < 0) {
            e.stopPropagation();
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </li>
  );
}
