import { useEffect, useState } from "react";
import type { v2 } from "@codex-pocket/protocol";
import { diffStats, splitGitDiff } from "../state/diff.js";
import { branchLabel, type FileMatch, type Session } from "../state/session.js";
import { DiffBody } from "./DiffView.js";
import { ChevronIcon, ExternalIcon, FileIcon, FolderIcon, SearchIcon } from "./icons.js";
import { friendlyError } from "../state/errors.js";
import { useSheetDrag } from "./gestures.js";
import { useDialog } from "./dialog.js";

// Scratch chats and plain folders are not repositories; that is a fact
// about the folder, not a failure to report in red.
const NOT_A_REPO = "This folder is not a git repository, so there is nothing to diff.";
const isNotARepo = (err: unknown) => err instanceof Error && /not a git repository/i.test(err.message);

export type WorkspaceTab = "modified" | "files";
type DiffMode = "uncommitted" | "branch";

const MAX_VIEW_BYTES = 512 * 1024;
const MODE_LABEL: Record<DiffMode, string> = { uncommitted: "Uncommitted", branch: "Branch" };

// The official app's Changes / Files sheet: one full-height panel with a
// Modified tab (git diff of the working tree, per file, hunks expandable)
// and an All Files tab (lazy folder tree with fuzzy search at the bottom).
export function WorkspaceSheet({ session, cwd, initialTab, onClose }: { session: Session; cwd: string; initialTab: WorkspaceTab; onClose: () => void }) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [mode, setMode] = useState<DiffMode>("uncommitted");
  const [collapsed, setCollapsed] = useState(0);
  const [modeMenu, setModeMenu] = useState(false);
  const [changes, setChanges] = useState<{ files: v2.FileUpdateChange[]; branch: string; upstream: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; text: string | null } | null>(null);
  const drag = useSheetDrag(onClose);
  const dialog = useDialog(tab === "modified" ? "Changes" : "Files", onClose);

  async function openFile(path: string) {
    setError(null);
    try {
      const text = await session.readTextFile(path);
      setFile({ path, text: text !== null && text.length > MAX_VIEW_BYTES ? `${text.slice(0, MAX_VIEW_BYTES)}\n…` : text });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  useEffect(() => {
    if (tab !== "modified") return;
    let cancelled = false;
    setChanges(null);
    setError(null);
    session
      .gitChanges(cwd, mode)
      .then((r) => !cancelled && setChanges({ files: splitGitDiff(r.diff, cwd), branch: r.branch, upstream: r.upstream }))
      .catch((err) => !cancelled && setError(isNotARepo(err) ? NOT_A_REPO : friendlyError(err)));
    return () => {
      cancelled = true;
    };
  }, [tab, mode, cwd, session]);

  const totals = changes?.files.reduce(
    (acc, f) => {
      const s = diffStats(f.diff);
      return { added: acc.added + s.added, removed: acc.removed + s.removed };
    },
    { added: 0, removed: 0 },
  );

  if (file) {
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div ref={dialog.ref} {...dialog.props} className={`sheet workspace ${drag.dragging ? "dragging" : ""}`} style={drag.style} onClick={(e) => e.stopPropagation()} {...drag.handlers}>
          <FileViewer file={file} root={cwd} onBack={() => setFile(null)} onClose={onClose} />
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={dialog.ref} {...dialog.props} className={`sheet workspace ${drag.dragging ? "dragging" : ""}`} style={drag.style} onClick={(e) => e.stopPropagation()} {...drag.handlers}>
        <header className="workspace-head">
          <span className="workspace-head-side" />
          <div className="workspace-title">
            {tab === "modified" ? (
              <>
                <button className="title-btn" onClick={() => setModeMenu((v) => !v)} aria-expanded={modeMenu}>
                  {MODE_LABEL[mode]} <span className="chev down">▾</span>
                </button>
                {totals && (
                  <div className="diff-stats small">
                    <span className="add">+{totals.added}</span> <span className="del">−{totals.removed}</span>
                  </div>
                )}
                {modeMenu && (
                  <div className="popover-card menu mode-menu" role="menu">
                    {(Object.keys(MODE_LABEL) as DiffMode[]).map((m) => (
                      <button
                        key={m}
                        className="menu-item"
                        role="menuitemradio"
                        aria-checked={mode === m}
                        onClick={() => {
                          setMode(m);
                          setModeMenu(false);
                        }}
                      >
                        <span className="menu-check">{mode === m ? "✓" : ""}</span>
                        <span>{MODE_LABEL[m]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <h2>Files</h2>
            )}
          </div>
          <span className="workspace-head-side right">
            {tab === "modified" && (
              <button className="icon-btn round" aria-label="Collapse all" onClick={() => setCollapsed((n) => n + 1)}>
                ⤡
              </button>
            )}
            <button className="icon-btn round" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </span>
        </header>
        <div className="segmented pill">
          <button className={tab === "modified" ? "active" : ""} onClick={() => setTab("modified")}>
            Modified
          </button>
          <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>
            All Files
          </button>
        </div>

        {tab === "modified" ? (
          <div className="workspace-body">
            {error && <p className={error === NOT_A_REPO ? "muted center" : "error"}>{error}</p>}
            {!changes && !error && <p className="muted center">Loading…</p>}
            {changes && changes.files.length === 0 && <p className="muted center">No {mode === "branch" ? "changes on this branch" : "uncommitted changes"}.</p>}
            {changes?.files.map((f) => (
              <ChangedFile key={`${f.path}-${collapsed}`} change={f} cwd={cwd} onOpen={f.kind.type === "delete" ? undefined : () => void openFile(f.path)} />
            ))}
            {changes && (
              <div className="workspace-foot muted">
                {branchLabel(changes.branch)}
                {changes.upstream && (
                  <>
                    {" "}
                    → {changes.upstream}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <FilesTab session={session} root={cwd} onOpen={(path) => void openFile(path)} />
        )}
      </div>
    </div>
  );
}

function shortDir(path: string, cwd: string): string {
  const rel = path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

// One file card: name, folder, +/- and the hunks below (collapsible).
function ChangedFile({ change, cwd, onOpen }: { change: v2.FileUpdateChange; cwd: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(true);
  const stats = diffStats(change.diff);
  const name = change.path.split("/").pop() ?? change.path;
  return (
    <section className="changed-file">
      <div className="changed-file-head">
        <div className="changed-file-name">
          <div>
            {name}
            {change.kind.type !== "update" && <span className={`kind ${change.kind.type}`}> {change.kind.type}</span>}
          </div>
          <div className="muted small">{shortDir(change.path, cwd) || "."}</div>
        </div>
        <span className="diff-stats">
          {stats.added > 0 && <span className="add">+{stats.added}</span>}
          {stats.removed > 0 && <span className="del">−{stats.removed}</span>}
        </span>
        {onOpen && (
          <button className="icon-btn" aria-label="Open file" onClick={onOpen}>
            <ExternalIcon />
          </button>
        )}
      </div>
      <button className="hunk-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`chev ${open ? "down" : ""}`}>
          <ChevronIcon />
        </span>
        <span>{hunkRange(change.diff)}</span>
        <span className="spacer" />
        <span className="diff-stats small">
          {stats.added > 0 && <span className="add">+{stats.added}</span>}
          {stats.removed > 0 && <span className="del">−{stats.removed}</span>}
        </span>
      </button>
      {open && <DiffBody diff={change.diff} />}
    </section>
  );
}

function hunkRange(diff: string): string {
  const hunks = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)];
  if (hunks.length === 0) return "Diff";
  const first = Number(hunks[0][1]);
  const lastStart = Number(hunks[hunks.length - 1][1]);
  const lastLen = Number(hunks[hunks.length - 1][2] ?? 1);
  return `Lines ${first}-${Math.max(first, lastStart + lastLen - 1)}`;
}

interface Node {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: Node[] | null;
}

function FilesTab({ session, root, onOpen }: { session: Session; root: string; onOpen: (path: string) => void }) {
  const [tree, setTree] = useState<Node[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FileMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(path: string): Promise<Node[]> {
    const entries = await session.listEntries(path);
    return entries.map((e) => ({ name: e.name, path: `${path}/${e.name}`, isDirectory: e.isDirectory, children: e.isDirectory ? null : undefined }));
  }

  useEffect(() => {
    let cancelled = false;
    load(root)
      .then((n) => !cancelled && setTree(n))
      .catch((err) => !cancelled && setError(friendlyError(err)));
    return () => {
      cancelled = true;
    };
  }, [root]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    const t = window.setTimeout(() => void session.searchFiles(query).then(setMatches).catch(() => setMatches([])), 150);
    return () => window.clearTimeout(t);
  }, [query, session]);

  async function toggle(node: Node) {
    const next = new Set(expanded);
    if (next.has(node.path)) next.delete(node.path);
    else {
      next.add(node.path);
      if (node.children === null) {
        try {
          const children = await load(node.path);
          setTree((t) => (t ? patchNode(t, node.path, children) : t));
        } catch (err) {
          setError(friendlyError(err));
        }
      }
    }
    setExpanded(next);
  }

  const openFile = (path: string) => Promise.resolve(onOpen(path));

  const renderNodes = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((n) => (
      <li key={n.path}>
        <button className="tree-row" style={{ paddingLeft: 12 + depth * 20 }} onClick={() => (n.isDirectory ? void toggle(n) : void openFile(n.path))}>
          <span className={`tree-chev ${n.isDirectory ? (expanded.has(n.path) ? "down" : "") : "none"}`}>{n.isDirectory && <ChevronIcon />}</span>
          <span className="menu-icon">{n.isDirectory ? <FolderIcon /> : <FileIcon />}</span>
          <span className="tree-name">{n.name}</span>
        </button>
        {n.isDirectory && expanded.has(n.path) && n.children && (
          <ul className="tree">{n.children.length > 0 ? renderNodes(n.children, depth + 1) : <li className="tree-empty muted" style={{ paddingLeft: 44 + depth * 20 }}>Empty</li>}</ul>
        )}
      </li>
    ));

  return (
    <>
      <div className="workspace-body">
        {error && <p className="error">{error}</p>}
        {query.trim() ? (
          <ul className="tree">
            {matches.map((m) => (
              <li key={m.path}>
                <button className="tree-row" onClick={() => void openFile(m.path)}>
                  <span className="tree-chev none" />
                  <span className="menu-icon">
                    <FileIcon />
                  </span>
                  <span className="tree-name">
                    {m.name}
                    <span className="muted small"> {m.relative}</span>
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <p className="muted center">No matches.</p>}
          </ul>
        ) : tree ? (
          <ul className="tree">{renderNodes(tree, 0)}</ul>
        ) : (
          !error && <p className="muted center">Loading…</p>
        )}
      </div>
      <label className="search-pill workspace-search">
        <SearchIcon />
        <input type="search" placeholder="Search files" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
    </>
  );
}

function patchNode(nodes: Node[], path: string, children: Node[]): Node[] {
  return nodes.map((n) => (n.path === path ? { ...n, children } : n.children ? { ...n, children: patchNode(n.children, path, children) } : n));
}

// Official-style file view: back / name / close on top, then numbered,
// wrapped lines. Markdown headings get a touch of colour; everything else
// stays plain (no highlighter on the phone).
function FileViewer({ file, root, onBack, onClose }: { file: { path: string; text: string | null }; root: string; onBack: () => void; onClose: () => void }) {
  const name = file.path.split("/").pop() ?? file.path;
  const rel = file.path.startsWith(root + "/") ? file.path.slice(root.length + 1) : file.path;
  const isMarkdown = /\.(md|markdown)$/i.test(name);
  const lines = file.text === null ? [] : file.text.split("\n");
  return (
    <>
      <header className="workspace-head viewer-head">
        <button className="icon-btn round" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        <div className="viewer-title" title={rel}>
          {name}
        </div>
        <span className="workspace-head-side right">
          <button className="icon-btn round" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </span>
      </header>
      <div className="workspace-body viewer-body">
        {file.text === null ? (
          <p className="muted center">Binary file.</p>
        ) : (
          <pre className="code-view">
            {lines.map((line, i) => (
              <span key={i} className={`code-line ${isMarkdown && /^#{1,6}\s/.test(line) ? "hl-heading" : ""}`}>
                <span className="code-no">{i + 1}</span>
                <span className="code-text">{line || " "}</span>
              </span>
            ))}
          </pre>
        )}
      </div>
    </>
  );
}
