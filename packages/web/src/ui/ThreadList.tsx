import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCollapsedSections, getListView, setListView, setSectionCollapsed, type ListSection, type ListView } from "../state/list-prefs.js";
import { getPins } from "../state/pins.js";
import type { Session, ThreadStatus, ThreadSummary } from "../state/session.js";
import { groupByProject, isScratchThread, isWorktree, projectForCwd } from "../state/projects.js";
import { useStore } from "../state/store.js";
import { friendlyError } from "../state/errors.js";
import { ArchiveIcon, BranchIcon, ChevronIcon, ComposeIcon, FolderIcon, MonitorIcon, SearchIcon } from "./icons.js";
import { ListMenu } from "./ListMenu.js";
import { navigate } from "./route.js";
import { useComputers } from "./ComputerContext.js";

/** Re-renders the caller once a minute so "3m" ages while the list sits open. */
export function useMinuteTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
}

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

// Re-exported for the archived list and tests; the real logic lives in
// state/projects.ts, which groups by app-server's projects rather than by cwd.
export { groupByProject, isScratchThread, isWorktree };

// Where the list was when a thread was opened, so coming back lands on the
// same rows with the same project unfolded, as a native list would. Module
// state: the list unmounts while a thread is on screen, but the page lives on.
const positions = new Map<string, { scrollTop: number; expanded: string | null }>();

export function ThreadList({ session }: { session: Session }) {
  const computers = useComputers();
  const computerName = computers?.active?.name ?? session.host?.computer.name;
  const computerId = session.host?.id ?? "";
  const remembered = positions.get(computerId) ?? { scrollTop: 0, expanded: null };
  positions.set(computerId, remembered);
  const threads = useStore(session.store, (s) => s.threads);
  const projects = useStore(session.store, (s) => s.projects);
  const loading = useStore(session.store, (s) => s.threadsLoading);
  const error = useStore(session.store, (s) => s.threadsError);
  const connection = useStore(session.store, (s) => s.connection);
  const [view, setView] = useState<ListView>(getListView);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(remembered.expanded);
  const [collapsed, setCollapsed] = useState(() => getCollapsedSections(computerId));
  const scrollRef = useRef<HTMLDivElement>(null);
  // Highlighted in the split layout, where the list stays beside the thread.
  const openId = useStore(session.store, (s) => s.open?.view.threadId ?? null);
  useMinuteTick();

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = remembered.scrollTop;
    // Read it back on unmount: the node is still attached while cleanups run.
    return () => {
      remembered.scrollTop = el.scrollTop;
    };
  }, []);
  useEffect(() => {
    remembered.expanded = expanded;
  }, [expanded]);

  useEffect(() => {
    if (connection !== "open") return;
    void session.loadThreads();
    void session.loadProjects();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void session.refreshPendingThreads();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [connection, session]);

  const archive = (id: string) => void session.archiveThread(id).catch((err) => session.notify(friendlyError(err)));

  function changeView(v: ListView) {
    setListView(v);
    setView(v);
  }

  function toggleSection(section: ListSection) {
    const next = !collapsed[section];
    setSectionCollapsed(section, next, computerId);
    setCollapsed((c) => ({ ...c, [section]: next }));
  }

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? threads.filter((t) => {
            const project = projectForCwd(t.cwd, projects, t.projectId);
            return (
              t.title.toLowerCase().includes(q) ||
              projectName(t.cwd).toLowerCase().includes(q) ||
              (project?.name.toLowerCase().includes(q) ?? false)
            );
          })
        : threads,
    [threads, projects, q],
  );
  // Pinned threads sit in their own section and nowhere else (unless searching).
  const pinIds = getPins(computerId).join(",");
  const pinned = useMemo(() => (q ? [] : pinIds.split(",").map((id) => filtered.find((t) => t.id === id)).filter((t): t is ThreadSummary => t !== undefined)), [filtered, pinIds, q]);
  const rest = useMemo(() => (pinned.length > 0 ? filtered.filter((t) => !pinned.includes(t)) : filtered), [filtered, pinned]);
  const chats = useMemo(() => rest.filter(isScratchThread), [rest]);
  const grouped0 = useMemo(() => groupByProject(rest.filter((t) => !isScratchThread(t)), projects), [rest, projects]);
  // Project-less threads: no project and not a scratch chat. Listed under
  // "Chats" like the official app instead of inventing a project from the cwd.
  const chatsExtra = useMemo(
    () => [...chats, ...grouped0.ungrouped].sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, grouped0],
  );
  const groups = grouped0.groups;
  const grouped = view === "project" && !q;

  return (
    <main className="screen list">
      <header className="topbar plain">
        <h1 className="sr-only">Threads</h1>
        {computerName ? <span className="list-computer muted small" title={computerName}><MonitorIcon /><span>{computerName}</span></span> : <span className="spacer" />}
        <ListMenu session={session} view={view} onView={changeView} />
      </header>

      {error && <p className="error">{error}</p>}
      {threads.length === 0 && !loading && !error && <p className="muted center">No threads yet.</p>}
      {threads.length === 0 && loading && <ListSkeleton />}

      <div className="list-scroll" ref={scrollRef}>
        {pinned.length > 0 && (
          <>
            <h2 className="section-title">Pinned</h2>
            <ul className="thread-list">
              {pinned.map((t) => (
                <ThreadRow key={t.id} thread={t} selected={t.id === openId} showProject={!isScratchThread(t)} plain onArchive={archive} />
              ))}
            </ul>
          </>
        )}
        {grouped ? (
          <>
            {chatsExtra.length > 0 && (
              <>
                <SectionHeading label="Chats" collapsed={collapsed.chats} onToggle={() => toggleSection("chats")} />
                {!collapsed.chats && (
                  <ul className="thread-list">
                    {chatsExtra.map((t) => (
                      <ThreadRow key={t.id} thread={t} selected={t.id === openId} plain onArchive={archive} />
                    ))}
                  </ul>
                )}
              </>
            )}
            <h2 className="section-title">Projects</h2>
            {groups.length > 0 && (
              <ul className="project-list">
                {groups.map((g) => (
                  <li key={g.project.id}>
                    <div className="project-row">
                      <button
                        className="project-main"
                        aria-expanded={expanded === g.project.id}
                        onClick={() => setExpanded((e) => (e === g.project.id ? null : g.project.id))}
                      >
                        <span className="project-icon">
                          <FolderIcon />
                        </span>
                        <span className="project-name">{g.project.name}</span>
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`New thread in ${g.project.name}`}
                        onClick={() => navigate({ name: "new", cwd: g.project.roots[0] ?? "" })}
                      >
                        <ComposeIcon />
                      </button>
                    </div>
                    {expanded === g.project.id && (
                      <ul className="thread-list nested">
                        {g.threads.map((t) => (
                          <ThreadRow key={t.id} thread={t} selected={t.id === openId} compact onArchive={archive} />
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <ul className="thread-list">
            {rest.map((t) => (
              <ThreadRow key={t.id} thread={t} selected={t.id === openId} showProject={!isScratchThread(t)} plain onArchive={archive} />
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

// Cold start: the list has nothing to show until thread/list answers.
function ListSkeleton() {
  return (
    <div className="skeleton-rows" aria-hidden>
      {[68, 44, 56, 38, 60].map((w, i) => (
        <div key={i} className="skeleton-row">
          <span className="skeleton" style={{ width: "30%" }} />
          <span className="skeleton" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

// A section header that folds its list away, like the official app's "Chats"
// group (projects never fold). The whole heading is the hit target so it is
// easy to tap on a phone; the chevron sits after the label as in the official
// sidebar.
function SectionHeading({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <h2 className="section-title">
      <button className="section-toggle" aria-expanded={!collapsed} onClick={onToggle}>
        <span>{label}</span>
        <span className={`section-caret ${collapsed ? "collapsed" : ""}`} aria-hidden>
          <ChevronIcon />
        </span>
      </button>
    </h2>
  );
}

export function ThreadRow({
  thread,
  selected,
  showProject,
  compact,
  plain,
  onArchive,
}: {
  thread: ThreadSummary;
  /** The thread open beside the list (split layout). */
  selected?: boolean;
  showProject?: boolean;
  compact?: boolean;
  /** Title and project only, like the official "Chats" section. */
  plain?: boolean;
  onArchive: (id: string) => void;
}) {
  const open = () => navigate({ name: "thread", id: thread.id });
  const current = selected ? ("page" as const) : undefined;
  if (compact) {
    // Inside a project: one line, title left, time right.
    return (
      <SwipeRow onArchive={() => onArchive(thread.id)}>
        <button className="thread-row compact" aria-current={current} onClick={open}>
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
      <button className="thread-row" aria-current={current} onClick={open}>
        <div className="thread-row-body">
          {showProject && <div className="thread-project">{projectName(thread.cwd)}</div>}
          <div className="thread-title">{thread.title}</div>
        </div>
        <ThreadStateMark thread={thread} />
        {!plain && <span className="thread-time muted">{relativeTime(thread.updatedAt)}</span>}
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
        <span className="dot" aria-hidden="true" />
      </span>
    );
  }
  return null;
}

// Pill width plus its right inset, so the row stops flush with the button.
const SWIPE_REVEAL = 108;

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
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // Only a clearly sideways move starts a swipe; a fast, slightly slanted
      // scroll flick stays a scroll.
      st.axis = Math.abs(dx) > Math.abs(dy) * 2 ? "x" : "y";
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

  function onTouchCancel() {
    // The browser took the gesture (it started scrolling): never leave the
    // row half-open on the scroll's account.
    start.current = null;
    setDragging(false);
    setOffset(0);
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
        onTouchCancel={onTouchCancel}
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
