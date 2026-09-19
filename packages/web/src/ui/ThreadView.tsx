import { useEffect, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { ApprovalSheet } from "./ApprovalSheet.js";
import { Composer } from "./Composer.js";
import { Transcript } from "./TurnView.js";
import { PlanView } from "./PlanView.js";
import { ThreadMenu } from "./ThreadMenu.js";
import { navigate } from "./route.js";
import { UserInputSheet } from "./UserInputSheet.js";
import { USER_INPUT_METHOD } from "../state/thread-reducer.js";
import { QueuedList } from "./QueuedList.js";
import { WorkspaceSheet } from "./WorkspaceSheet.js";
import { threadChangeTotals } from "../state/turns.js";
import { diffStats } from "../state/diff.js";

export function ThreadView({ session }: { session: Session }) {
  const open = useStore(session.store, (s) => s.open);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [showChanges, setShowChanges] = useState(false);

  const items = open?.view.items ?? [];
  const lastItem = items[items.length - 1];
  const lastText = lastItem && "text" in lastItem ? (lastItem as { text: string }).text.length : 0;

  // Follow new output unless the user scrolled up to read history.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, lastText, open?.state]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAwayFromBottom(!stickToBottom.current);
    if (el.scrollTop < 40 && open?.olderCursor && !open.loadingOlder) {
      const before = el.scrollHeight;
      void session.loadOlder().then(() => {
        // Keep the viewport anchored on the same content after prepending.
        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop += listRef.current.scrollHeight - before;
        });
      });
    }
  }

  function scrollToBottom() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = true;
    setAwayFromBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  if (!open) return null;
  const busy = open.view.activeTurnId !== null;
  const pending = open.view.approvals[0];
  const totals = threadChangeTotals(open.view, diffStats);

  return (
    <main className="screen thread">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <div className="topbar-title">
          <h1>{open.cwd.split("/").filter(Boolean).pop() ?? "Thread"}</h1>
          <div className="topbar-meta muted small">{open.cwd}</div>
        </div>
        <ThreadMenu session={session} />
      </header>

      {open.state === "locked" && (
        <div className="notice">
          <p>This thread is open in the Codex desktop app. Close it there to continue from your phone.</p>
          <button onClick={() => void session.openThread(open.view.threadId, { force: true })}>Retry</button>
        </div>
      )}
      {open.state === "error" && (
        <div className="notice error">
          <p>{open.error}</p>
          <button onClick={() => void session.openThread(open.view.threadId, { force: true })}>Retry</button>
        </div>
      )}
      {open.view.alerts.map((a) => (
        <div key={a.id} className={`alert ${a.kind}`}>
          <span>{a.message}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => session.dismissAlert(a.id)}>
            ×
          </button>
        </div>
      ))}

      <div className="items" ref={listRef} onScroll={onScroll}>
        {open.loadingOlder && <p className="muted center">Loading…</p>}
        {open.state === "loading" && items.length === 0 && <p className="muted center">Loading…</p>}
        <Transcript session={session} view={open.view} cwd={open.cwd} />
        {open.view.plan && <PlanView plan={open.view.plan} />}
        {open.queue.length > 0 && <QueuedList session={session} queue={open.queue} busy={busy} />}
        {open.view.lastTurnError && (
          <div className="turn-error">
            <p className="error">{open.view.lastTurnError}</p>
            {!busy && open.state === "ready" && (
              <button className="link-btn" onClick={() => void session.retryLastTurn()}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {awayFromBottom && (
        <button className="scroll-bottom-btn" aria-label="Scroll to bottom" onClick={scrollToBottom}>
          ↓
        </button>
      )}

      {totals.files > 0 && open.cwd && (
        <div className="changes-pill-row">
          <button className="changes-pill" onClick={() => setShowChanges(true)} aria-label="Show changes">
            <span>
              {totals.files} file{totals.files === 1 ? "" : "s"}
            </span>
            <span className="diff-stats">
              <span className="add">+{totals.added}</span> <span className="del">−{totals.removed}</span>
            </span>
          </button>
        </div>
      )}
      {showChanges && <WorkspaceSheet session={session} cwd={open.cwd} initialTab="modified" onClose={() => setShowChanges(false)} />}

      {pending && pending.method === USER_INPUT_METHOD && <UserInputSheet session={session} request={pending} />}
      {pending && pending.method !== USER_INPUT_METHOD && <ApprovalSheet session={session} approval={pending} items={items} cwd={open.cwd} />}

      <Composer
        session={session}
        disabled={open.state !== "ready"}
        busy={busy}
        onStop={() => void session.interrupt()}
        onResume={open.queue.length > 0 ? () => void session.resumeQueue() : undefined}
      />
    </main>
  );
}
