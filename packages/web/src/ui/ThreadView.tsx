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
import { ELICITATION_METHOD, USER_INPUT_METHOD } from "../state/thread-reducer.js";
import { ElicitationSheet } from "./ElicitationSheet.js";
import { QueuedList } from "./QueuedList.js";
import { WorkspaceChangesButton } from "./WorkspaceChangesButton.js";
import { friendlyError } from "../state/errors.js";
import { useSwipeBack } from "./gestures.js";
import { useComputers } from "./ComputerContext.js";

export function ThreadView({ session }: { session: Session }) {
  const computers = useComputers();
  const computerName = computers?.active?.name ?? session.host?.computer.name;
  const open = useStore(session.store, (s) => s.open);
  const connected = useStore(session.store, (s) => s.connection === "open" && s.upstreamConnected);
  // The list's title for this thread; the folder name stands in until the
  // list has loaded (a push notification can open a thread first).
  const title = useStore(session.store, (s) => s.threads.find((t) => t.id === s.open?.view.threadId)?.title ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const back = useSwipeBack(() => navigate({ name: "list" }));

  const items = open?.view.items ?? [];
  const lastItem = items[items.length - 1];
  const lastText = lastItem && "text" in lastItem ? (lastItem as { text: string }).text.length : 0;

  // Follow new output unless the user scrolled up to read history.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, lastText, open?.state, open?.view.pending.length]);

  // Older pages arrive on a scroll, so a transcript that does not overflow
  // the screen — a couple of short turns — would have no way to ask for the
  // rest of the thread. Pull pages until there is something to scroll.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !open || open.state === "loading" || !open.olderCursor || open.loadingOlder) return;
    if (el.scrollHeight - el.clientHeight >= 80) return;
    void session.loadOlder();
  }, [session, open?.state, open?.olderCursor, open?.loadingOlder, items.length]);

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

  return (
    <main className={`screen thread ${back.dragging ? "dragging" : ""}`} style={back.style} {...back.handlers}>
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <div className="topbar-title">
          <h1>{title ?? open.cwd.split("/").filter(Boolean).pop() ?? "Thread"}</h1>
          <div className="topbar-meta thread-location muted small">
            {computerName && <span className="thread-computer" title={computerName}>{computerName}</span>}
            <span className="thread-cwd" title={open.cwd}>{open.cwd}</span>
          </div>
        </div>
        <ThreadMenu session={session} />
      </header>

      {open.state === "locked" && (
        <div className="notice">
          <p>This thread is open in the Codex desktop app. Close it there to continue from your phone.</p>
          <button onClick={() => void session.openThread(open.view.threadId, { force: true })}>Retry</button>
        </div>
      )}
      {open.state === "archived" && (
        <div className="notice">
          <p>This thread is archived. Unarchive it to continue.</p>
          <button onClick={() => void session.unarchiveThread(open.view.threadId).catch((err) => session.notify(friendlyError(err)))}>Unarchive and open</button>
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
        {open.state === "loading" && items.length === 0 && (
          <div className="skeleton-msgs" aria-hidden>
            <span className="skeleton skeleton-msg user" />
            <span className="skeleton skeleton-msg agent" />
            <span className="skeleton skeleton-msg user" />
            <span className="skeleton skeleton-msg agent" />
          </div>
        )}
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

      {open.cwd && <WorkspaceChangesButton key={`workspace-changes:${open.view.threadId}`} session={session} cwd={open.cwd} view={open.view} connected={connected} />}

      {pending && pending.method === USER_INPUT_METHOD && <UserInputSheet session={session} request={pending} />}
      {pending && pending.method === ELICITATION_METHOD && <ElicitationSheet session={session} request={pending} />}
      {pending && pending.method !== USER_INPUT_METHOD && pending.method !== ELICITATION_METHOD && <ApprovalSheet session={session} approval={pending} items={items} cwd={open.cwd} />}

      <Composer
        key={open.view.threadId}
        session={session}
        draftKey={open.view.threadId}
        disabled={open.state !== "ready"}
        busy={busy}
        onStop={() => void session.interrupt().catch((err) => session.notify(friendlyError(err)))}
        onResume={open.queue.length > 0 ? () => void session.resumeQueue() : undefined}
      />
    </main>
  );
}
