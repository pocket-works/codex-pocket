import { useEffect, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { navigate } from "./route.js";

export function NewThread({ session, presetCwd }: { session: Session; presetCwd?: string }) {
  const threads = useStore(session.store, (s) => s.threads);
  const models = useStore(session.store, (s) => s.models);
  const connection = useStore(session.store, (s) => s.connection);
  const cwds = session.knownCwds();
  const [cwd, setCwd] = useState(presetCwd ?? "");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (connection !== "open") return;
    if (threads.length === 0) void session.loadThreads();
    void session.loadModels().catch(() => {});
  }, [connection, session, threads.length]);

  useEffect(() => {
    if (!cwd && cwds.length > 0) setCwd(cwds[0]);
  }, [cwds, cwd]);

  async function create() {
    if (!cwd) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = models.find((m) => m.id === model);
      const id = await session.startThread(cwd, chosen ? chosen.model : null, chosen ? chosen.defaultReasoningEffort : null);
      navigate({ name: "thread", id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <h1>New thread</h1>
      </header>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          Project folder
          <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
            {!cwds.includes(cwd) && cwd && <option value={cwd}>{cwd}</option>}
            {cwds.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="subtle" onClick={() => setBrowsing((b) => !b)}>
          {browsing ? "Hide folders" : "Browse folders…"}
        </button>
        {browsing && (
          <FolderBrowser
            session={session}
            start={cwd || cwds[0] || "/"}
            onPick={(path) => {
              setCwd(path);
              setBrowsing(false);
            }}
          />
        )}
        <label>
          Model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Codex default</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={!cwd || busy}>
          {busy ? "Starting…" : "Start"}
        </button>
      </form>
    </main>
  );
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

// Walks directories on the Mac via fs/readDirectory. Starts next to the
// most recent project so sibling repos are one tap away.
function FolderBrowser({ session, start, onPick }: { session: Session; start: string; onPick: (path: string) => void }) {
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
    <div className="folder-browser">
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
  );
}
