import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getToken } from "../state/auth.js";
import type { Draft } from "../state/compose.js";
import { branchLabel, type Session } from "../state/session.js";
import { projectForCwd } from "../state/projects.js";
import { useStore } from "../state/store.js";
import { Composer } from "./Composer.js";
import { BranchIcon, ChatIcon, CheckIcon, ChevronsIcon, FolderIcon, LaptopIcon, MonitorIcon, WorktreeIcon } from "./icons.js";
import { navigate } from "./route.js";

/** Where the thread will run: a project folder, or a scratch folder like the desktop app's "Chat". */
type Target = { kind: "project"; cwd: string } | { kind: "chat" };

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

/** Option labels: the folder name, plus its parent when two folders share a name. */
export function optionLabels(cwds: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const c of cwds) counts.set(projectName(c), (counts.get(projectName(c)) ?? 0) + 1);
  return new Map(
    cwds.map((c) => {
      const parts = c.split("/").filter(Boolean);
      const name = parts.pop() ?? c;
      return [c, (counts.get(name) ?? 0) > 1 && parts.length > 0 ? `${parts.pop()}/${name}` : name];
    }),
  );
}

type Mode = "local" | "worktree";

interface GitState {
  cwd: string;
  branch: string;
  branches: string[];
}

// Laid out like the official app's new-chat screen: a back button, the
// setup rows (machine, project, local/worktree, branch) pinned above the
// composer, model/permissions/fast on the composer toolbar (backed by the
// draft `open`), and the thread is only created when the first message is sent.
export function NewThread({ session, presetCwd }: { session: Session; presetCwd?: string }) {
  const threads = useStore(session.store, (s) => s.threads);
  const projects = useStore(session.store, (s) => s.projects);
  const connection = useStore(session.store, (s) => s.connection);
  // Every project root is offered, so multi-folder and empty projects are
  // reachable; recent folders from the thread list fill in the gaps.
  const cwds = useMemo(() => {
    const out: string[] = [];
    for (const p of projects) for (const root of p.roots) if (!out.includes(root)) out.push(root);
    for (const c of session.knownCwds()) if (!out.includes(c)) out.push(c);
    return out;
  }, [projects, session]);
  const [me, setMe] = useState<{ host?: string; home?: string } | null>(null);
  const [target, setTarget] = useState<Target>(presetCwd ? { kind: "project", cwd: presetCwd } : { kind: "chat" });
  const [mode, setMode] = useState<Mode>("local");
  const [git, setGit] = useState<GitState | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const cwd = target.kind === "project" ? target.cwd : "";

  useEffect(() => {
    if (connection !== "open") return;
    if (threads.length === 0) void session.loadThreads();
    if (projects.length === 0) void session.loadProjects();
    void session.loadModels().catch(() => {});
  }, [connection, session, threads.length, projects.length]);

  useEffect(() => {
    session.setDraftCwd(cwd);
  }, [cwd, session]);

  // Branch info for the chosen folder; rows hide when it is not a repo.
  useEffect(() => {
    setGit(null);
    setBranch(null);
    if (!cwd || connection !== "open") return;
    let cancelled = false;
    void session.gitInfo(cwd).then((info) => {
      if (!cancelled && info) setGit({ cwd, ...info });
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, connection, session]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<{ host?: string; home?: string }>) : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const host = me?.host ?? location.hostname;
  const repo = git?.cwd === cwd ? git : null;
  const chosenBranch = branch ?? repo?.branch ?? null;
  const ready = target.kind === "project" ? mode === "local" || Boolean(me?.home) : Boolean(me?.home);

  async function start(draft: Draft) {
    let dir = cwd;
    if (target.kind === "chat") {
      if (!me?.home) throw new Error("Still finding your home folder; try again");
      dir = await session.createScratchDir(me.home, draft.text);
    } else if (repo && mode === "worktree") {
      if (!me?.home) throw new Error("Still finding your home folder; try again");
      dir = await session.gitWorktreeAdd(cwd, me.home, chosenBranch ?? repo.branch);
    } else if (repo && chosenBranch && chosenBranch !== repo.branch) {
      await session.gitSwitch(cwd, chosenBranch);
    }
    // Picks made on the toolbar live on the draft `open`; thread/start replaces it.
    const picked = session.store.get().open;
    const model = picked?.override ?? null;
    const perms = picked?.permissionOverride ?? null;
    const tier = picked?.serviceTierOverride ?? null;
    // A project-less chat must stay project-less even when its scratch folder
    // happens to sit under a project root, so only pass an id when picked.
    const projectId = target.kind === "project" ? (projectForCwd(cwd, projects, null)?.id ?? null) : null;
    const id = await session.startThread(dir, model?.model ?? null, model?.effort ?? null, tier === "default" ? null : tier, projectId);
    if (perms) session.setPermissions(perms.approval, perms.sandbox, perms.reviewer);
    await session.sendMessage(draft);
    navigate({ name: "thread", id });
  }

  const labels = optionLabels(cwds);
  const extra = cwd && !cwds.includes(cwd) ? [cwd] : [];

  return (
    <main className="screen new-thread">
      <header className="topbar plain">
        <button className="icon-btn round" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
      </header>

      <div className="spacer" />

      <ul className="setup-list">
        <li className="setup-row">
          <MonitorIcon />
          <span className="setup-value">{host}</span>
        </li>
        <li className="setup-row">
          {target.kind === "chat" ? <ChatIcon /> : <FolderIcon />}
          <RowMenu label={cwd ? projectName(cwd) : "Chat"}>
            {(close) => (
              <>
                <MenuItem checked={target.kind === "chat"} icon={<ChatIcon />} label="Chat" onPick={() => (setTarget({ kind: "chat" }), close())} />
                <hr />
                {[...extra, ...cwds].map((c) => (
                  <MenuItem key={c} checked={c === cwd} icon={<FolderIcon />} label={labels.get(c) ?? projectName(c)} onPick={() => (setTarget({ kind: "project", cwd: c }), close())} />
                ))}
                <hr />
                <MenuItem label="Browse folders…" muted onPick={() => (setBrowsing(true), close())} />
              </>
            )}
          </RowMenu>
        </li>
        {repo && (
          <>
            <li className="setup-row">
              {mode === "local" ? <LaptopIcon /> : <WorktreeIcon />}
              <RowMenu label={mode === "local" ? "Work locally" : "New worktree"}>
                {(close) => (
                  <>
                    <MenuItem checked={mode === "local"} icon={<LaptopIcon />} label="Work locally" onPick={() => (setMode("local"), close())} />
                    <MenuItem checked={mode === "worktree"} icon={<WorktreeIcon />} label="New worktree" onPick={() => (setMode("worktree"), close())} />
                  </>
                )}
              </RowMenu>
            </li>
            <li className="setup-row">
              <BranchIcon />
              <RowMenu label={branchLabel(chosenBranch ?? repo.branch)}>
                {(close) =>
                  repo.branches.map((b) => <MenuItem key={b} checked={b === chosenBranch} label={b} onPick={() => (setBranch(b), close())} />)
                }
              </RowMenu>
            </li>
          </>
        )}
      </ul>

      {browsing && (
        <FolderBrowser
          session={session}
          start={cwd || cwds[0] || "/"}
          onPick={(path) => {
            setTarget({ kind: "project", cwd: path });
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}

      <Composer session={session} draftKey="new" disabled={!ready} busy={false} placeholder={`Work on ${host}`} onSend={start} />
    </main>
  );
}

// A setup row's value with a popover menu, styled after the official pickers.
function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [show]);

  return (
    <div className="tool-anchor target-anchor" ref={ref}>
      <button type="button" className="setup-value select" aria-haspopup="menu" aria-expanded={show} onClick={() => setShow((v) => !v)}>
        <span>{label}</span>
        <ChevronsIcon />
      </button>
      {show && (
        <div className="popover-card target-menu" role="menu">
          {children(() => setShow(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ checked, icon, label, muted, onPick }: { checked?: boolean; icon?: ReactNode; label: string; muted?: boolean; onPick: () => void }) {
  return (
    <button type="button" className="popover-option" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} onClick={onPick}>
      <span className="popover-check">{checked && <CheckIcon />}</span>
      {icon}
      <span className={muted ? "muted" : undefined}>{label}</span>
    </button>
  );
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

// Walks directories on the Mac via fs/readDirectory. Starts next to the
// most recent project so sibling repos are one tap away.
function FolderBrowser({ session, start, onPick, onClose }: { session: Session; start: string; onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState(parentOf(start));
  const [dirs, setDirs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDirs(null);
    setError(null);
    session
      .listDirectory(path)
      .then((d) => !cancelled && setDirs(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [path, session]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet folder-browser" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="folder-path">
          <button type="button" className="icon-btn" aria-label="Up" disabled={path === "/"} onClick={() => setPath(parentOf(path))}>
            ‹
          </button>
          <span className="mono small">{path}</span>
          <button type="button" className="primary" onClick={() => onPick(path)}>
            Use
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {dirs === null && !error && <p className="muted small">Loading…</p>}
        {dirs && dirs.length === 0 && <p className="muted small">No subfolders.</p>}
        <ul className="folder-list">
          {dirs?.map((d) => (
            <li key={d}>
              <button type="button" onClick={() => setPath(path === "/" ? `/${d}` : `${path}/${d}`)}>
                {d}/
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
