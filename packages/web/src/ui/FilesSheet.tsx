import { useEffect, useState } from "react";
import type { Session } from "../state/session.js";
import { FileIcon, FolderIcon } from "./icons.js";

const MAX_VIEW_BYTES = 512 * 1024;

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

// Read-only browser of the thread's working directory: folders first,
// tap a file to read it (text only).
export function FilesSheet({ session, root, onClose }: { session: Session; root: string; onClose: () => void }) {
  const [path, setPath] = useState(root);
  const [entries, setEntries] = useState<{ name: string; isDirectory: boolean }[] | null>(null);
  const [file, setFile] = useState<{ path: string; text: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    session
      .listEntries(path)
      .then((e) => !cancelled && setEntries(e))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [path, session]);

  async function openFile(name: string) {
    const full = `${path}/${name}`;
    setError(null);
    try {
      const text = await session.readTextFile(full);
      setFile({ path: full, text: text !== null && text.length > MAX_VIEW_BYTES ? `${text.slice(0, MAX_VIEW_BYTES)}\n…` : text });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const rel = (p: string) => (p === root ? "/" : p.startsWith(root + "/") ? p.slice(root.length) : p);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall files-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="folder-path">
          <button
            type="button"
            className="icon-btn"
            aria-label="Up"
            disabled={file ? false : path === root}
            onClick={() => (file ? setFile(null) : setPath(parentOf(path)))}
          >
            ‹
          </button>
          <span className="mono small">{rel(file?.path ?? path)}</span>
        </div>
        {error && <p className="error">{error}</p>}
        {file ? (
          file.text === null ? (
            <p className="muted center">Binary file.</p>
          ) : (
            <pre className="mono file-view">{file.text}</pre>
          )
        ) : (
          <>
            {entries === null && !error && <p className="muted small">Loading…</p>}
            {entries && entries.length === 0 && <p className="muted small">Empty folder.</p>}
            <ul className="folder-list">
              {entries?.map((e) => (
                <li key={e.name}>
                  <button type="button" onClick={() => (e.isDirectory ? setPath(`${path}/${e.name}`) : void openFile(e.name))}>
                    <span className="menu-icon">{e.isDirectory ? <FolderIcon /> : <FileIcon />}</span>
                    {e.name}
                    {e.isDirectory ? "/" : ""}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
