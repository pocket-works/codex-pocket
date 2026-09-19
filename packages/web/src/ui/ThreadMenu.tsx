import { useEffect, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { transcriptMarkdown } from "../state/turns.js";
import { ArchiveIcon, BranchIcon, CompressIcon, CopyIcon, PencilIcon, ReviewIcon } from "./icons.js";
import { MenuItem } from "./ListMenu.js";
import { navigate } from "./route.js";

// "⋯" in the thread topbar: a compact anchored menu like the official app's
// thread header (rename / copy / fork / archive). Approval policy and the
// follow-up mode live with the composer's permissions button instead.
export function ThreadMenu({ session }: { session: Session }) {
  const open = useStore(session.store, (s) => s.open);
  const [show, setShow] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const ready = open.state === "ready";
  const running = open.view.activeTurnId !== null;
  const usage = open.view.tokenUsage;
  const contextPct = usage?.contextWindow ? Math.min(100, Math.round((usage.contextTokens / usage.contextWindow) * 100)) : null;

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
        <div className="popover-card menu right" role="menu">
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
              <MenuItem icon={<PencilIcon />} label="Rename" disabled={busy} onClick={() => setRenaming("")} />
              <MenuItem
                icon={<CopyIcon />}
                label="Copy as Markdown"
                disabled={busy || open.view.items.length === 0}
                onClick={() => void run(() => navigator.clipboard.writeText(transcriptMarkdown(open.view)))}
              />
              <MenuItem
                icon={<BranchIcon size={20} />}
                label="Fork"
                disabled={busy || !ready}
                onClick={() => void run(async () => navigate({ name: "thread", id: await session.forkThread(threadId) }))}
              />
              <div className="menu-sep" />
              <MenuItem icon={<ReviewIcon />} label="Review changes" disabled={busy || !ready || running} onClick={() => void run(() => session.startReview())} />
              <MenuItem
                icon={<CompressIcon />}
                label="Compact context"
                hint={contextPct !== null ? `· ${contextPct}% full` : undefined}
                disabled={busy || !ready || running}
                onClick={() => void run(() => session.compactThread())}
              />
              <div className="menu-sep" />
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
