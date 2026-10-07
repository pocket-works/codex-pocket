import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { ApprovalSheet } from "./ApprovalSheet.js";
import { Composer } from "./Composer.js";
import { Transcript } from "./TurnView.js";
import { PlanView } from "./PlanView.js";
import { ThreadMenu } from "./ThreadMenu.js";
import { navigate, useRoute } from "./route.js";
import { UserInputSheet } from "./UserInputSheet.js";
import { ELICITATION_METHOD, USER_INPUT_METHOD } from "../state/thread-reducer.js";
import { ElicitationSheet } from "./ElicitationSheet.js";
import { QueuedList } from "./QueuedList.js";
import { WorkspaceChangesButton } from "./WorkspaceChangesButton.js";
import { friendlyError } from "../state/errors.js";
import { useSwipeBack } from "./gestures.js";
import { useComputers } from "./ComputerContext.js";
import { canAcceptInput } from "../state/thread-list.js";
import { SubagentsEntry, SubagentsSheet } from "./Subagents.js";

export function ThreadView({ session }: { session: Session }) {
  const computers = useComputers();
  const computerName = computers?.active?.name ?? session.host?.computer.name;
  const open = useStore(session.store, (s) => s.open);
  const route = useRoute();
  const parentThreadId = open?.parentThreadId ?? null;
  const goBack = () => navigate(parentThreadId ? { name: "thread", id: parentThreadId, subagents: true } : { name: "list" });
  const connected = useStore(session.store, (s) => s.connection === "open" && s.upstreamConnected);
  // The list's title for this thread; the folder name stands in until the
  // list has loaded (a push notification can open a thread first).
  const title = useStore(session.store, (s) => s.threads.find((t) => t.id === s.open?.view.threadId)?.title ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const scrollSnapshot = useRef<{ threadId: string; height: number; top: number; firstItemId: string | undefined } | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const back = useSwipeBack(goBack);

  const items = open?.view.items ?? [];
  const hasOlder = !!open?.olderCursor || !!open?.olderEntries?.length;
  const lastItem = items[items.length - 1];
  const lastText = lastItem && "text" in lastItem ? (lastItem as { text: string }).text.length : 0;

  // Follow new output, or anchor the visible content when history arrives.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !open) return;
    const previous = scrollSnapshot.current;
    if (previous?.threadId !== open.view.threadId) {
      stickToBottom.current = true;
      setAwayFromBottom(false);
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (previous?.firstItemId && previous.firstItemId !== items[0]?.id && items.some((item) => item.id === previous.firstItemId)) {
      el.scrollTop = previous.top + el.scrollHeight - previous.height;
    }
    scrollSnapshot.current = { threadId: open.view.threadId, height: el.scrollHeight, top: el.scrollTop, firstItemId: items[0]?.id };
  }, [items, lastText, open?.view.threadId, open?.state, open?.view.pending.length, open?.loadingOlder]);

  // Older pages arrive on a scroll, so a transcript that does not overflow
  // the screen — a couple of short turns — would have no way to ask for the
  // rest of the thread. Pull pages until there is something to scroll.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !open || open.state === "loading" || !hasOlder || open.loadingOlder) return;
    if (el.scrollHeight - el.clientHeight >= 80) return;
    void session.loadOlder();
  }, [session, open?.state, open?.olderCursor, hasOlder, open?.loadingOlder, items.length]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    if (scrollSnapshot.current) scrollSnapshot.current.top = el.scrollTop;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAwayFromBottom(!stickToBottom.current);
    if (el.scrollTop < 40 && open && hasOlder && !open.loadingOlder) {
      void session.loadOlder();
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
  const readOnly = !canAcceptInput(open);
  const showSubagents = route.name === "thread" && route.id === open.view.threadId && route.subagents === true;

  return (
    <main className={`screen thread ${back.dragging ? "dragging" : ""}`} style={back.style} {...back.handlers}>
      <header className="topbar">
        <button className="icon-btn" aria-label={parentThreadId ? "Back to subagents" : "Back"} title={parentThreadId ? "Back to subagents" : "Back"} onClick={goBack}>
          ‹
        </button>
        <div className="topbar-title">
          <h1>{open.agentNickname || title || open.cwd.split("/").filter(Boolean).pop() || "Thread"}</h1>
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
        <Transcript session={session} view={open.view} cwd={open.cwd} readOnly={readOnly} />
        {open.view.plan && <PlanView plan={open.view.plan} />}
        {!readOnly && open.queue.length > 0 && <QueuedList session={session} queue={open.queue} busy={busy} />}
        {open.view.lastTurnError && (
          <div className="turn-error">
            <p className="error">{open.view.lastTurnError}</p>
            {!readOnly && !busy && open.state === "ready" && (
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

      <div className="thread-context-row">
        {open.cwd && <WorkspaceChangesButton key={`workspace-changes:${open.view.threadId}`} session={session} cwd={open.cwd} view={open.view} connected={connected} />}
        <SubagentsEntry key={`subagents:${open.view.threadId}`} session={session} parentThreadId={open.view.threadId} connected={connected} expanded={showSubagents} />
      </div>

      {pending && pending.method === USER_INPUT_METHOD && <UserInputSheet session={session} request={pending} />}
      {pending && pending.method === ELICITATION_METHOD && <ElicitationSheet session={session} request={pending} />}
      {pending && pending.method !== USER_INPUT_METHOD && pending.method !== ELICITATION_METHOD && <ApprovalSheet session={session} approval={pending} items={items} cwd={open.cwd} />}

      {readOnly ? (
        <div className="subagent-footer">
          <span className="muted small">Read-only</span>
          {parentThreadId && <button className="link-btn" onClick={() => navigate({ name: "thread", id: parentThreadId })}>Return to parent chat</button>}
        </div>
      ) : <Composer
        key={open.view.threadId}
        session={session}
        draftKey={open.view.threadId}
        disabled={open.state !== "ready"}
        busy={busy}
        onStop={() => void session.interrupt().catch((err) => session.notify(friendlyError(err)))}
        onResume={open.queue.length > 0 ? () => void session.resumeQueue() : undefined}
      />}
      {showSubagents && <SubagentsSheet key={`subagents-sheet:${open.view.threadId}`} session={session} parentThreadId={open.view.threadId} onClose={() => navigate({ name: "thread", id: open.view.threadId })} />}
    </main>
  );
}
