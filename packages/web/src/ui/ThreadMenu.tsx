import { useEffect, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import { isPinned, togglePin } from "../state/pins.js";
import { useStore } from "../state/store.js";
import { ChangesSheet } from "./ChangesSheet.js";
import { FilesSheet } from "./FilesSheet.js";
import { ArchiveIcon, BranchIcon, CopyIcon, FolderIcon, PencilIcon, PinIcon } from "./icons.js";
import { MenuItem } from "./ListMenu.js";
import { navigate } from "./route.js";

// "⋯" in the thread topbar, laid out like the official iOS app's thread
// menu: title, Pin / Rename / Copy thread ID / Archive, then Changes and
// Files. Forking lives on each answer's action row, as in the official app.
export function ThreadMenu({ session }: { session: Session }) {
  const open = useStore(session.store, (s) => s.open);
  const title = useStore(session.store, (s) => s.threads.find((t) => t.id === s.open?.view.threadId)?.title ?? null);
  const [show, setShow] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"changes" | "files" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [show]);

  if (!open) return null;
  const threadId = open.view.threadId;
  const running = open.view.activeTurnId !== null;
  const pinned = isPinned(threadId);

  function close() {
    setShow(false);
    setRenaming(null);
    setError(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool-anchor" ref={ref}>
      <button className="icon-btn" aria-label="Thread menu" aria-expanded={show} onClick={() => (show ? close() : setShow(true))}>
        ⋯
      </button>
      {show && (
        <div className="popover-card menu right ios" role="menu">
          <div className="menu-title" title={title ?? threadId}>
            {title ?? "Thread"}
          </div>
          {error && <p className="error small menu-error">{error}</p>}
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
            <>
              <MenuItem
                icon={<PinIcon />}
                label={pinned ? "Unpin" : "Pin"}
                onClick={() => {
                  togglePin(threadId);
                  bump((n) => n + 1);
                  session.touchThreads();
                  close();
                }}
              />
              <MenuItem icon={<PencilIcon />} label="Rename" disabled={busy} onClick={() => setRenaming(title ?? "")} />
              <MenuItem icon={<CopyIcon />} label="Copy thread ID" disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(threadId))} />
              <MenuItem
                icon={<ArchiveIcon />}
                label="Archive"
                danger
                disabled={busy}
                onClick={() => {
                  if (confirm(running ? "Stop and archive this thread?" : "Archive this thread?")) {
                    void run(async () => {
                      await session.archiveThread(threadId);
                      navigate({ name: "list" });
                    });
                  }
                }}
              />
              <div className="menu-sep thick" />
              <MenuItem
                icon={<BranchIcon size={22} />}
                label="Changes"
                onClick={() => {
                  setSheet("changes");
                  close();
                }}
              />
              <MenuItem
                icon={<FolderIcon />}
                label="Files"
                disabled={!open.cwd}
                onClick={() => {
                  setSheet("files");
                  close();
                }}
              />
            </>
          )}
        </div>
      )}
      {sheet === "changes" && <ChangesSheet view={open.view} cwd={open.cwd} onClose={() => setSheet(null)} />}
      {sheet === "files" && <FilesSheet session={session} root={open.cwd} onClose={() => setSheet(null)} />}
    </div>
  );
}
