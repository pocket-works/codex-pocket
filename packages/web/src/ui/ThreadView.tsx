import { useEffect, useRef } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { ApprovalSheet } from "./ApprovalSheet.js";
import { Composer } from "./Composer.js";
import { ItemView } from "./ItemView.js";
import { ModelPicker } from "./ModelPicker.js";
import { PlanView } from "./PlanView.js";
import { navigate } from "./route.js";
import { UserInputSheet } from "./UserInputSheet.js";
import { USER_INPUT_METHOD } from "../state/thread-reducer.js";

export function ThreadView({ session }: { session: Session }) {
  const open = useStore(session.store, (s) => s.open);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

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

  if (!open) return null;
  const busy = open.view.activeTurnId !== null;
  const pending = open.view.approvals[0];
  const usage = open.view.tokenUsage;
  const contextPct = usage?.contextWindow ? Math.min(100, Math.round((usage.contextTokens / usage.contextWindow) * 100)) : null;

  return (
    <main className="screen thread">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <div className="topbar-title">
          <h1>{open.cwd.split("/").filter(Boolean).pop() ?? "Thread"}</h1>
          <div className="topbar-meta">
            <ModelPicker session={session} />
            {contextPct !== null && (
              <span className={`context-pct ${contextPct >= 80 ? "high" : ""}`} title="Context window used">
                {contextPct}%
              </span>
            )}
          </div>
        </div>
        {busy && (
          <button className="danger" onClick={() => void session.interrupt()}>
            Stop
          </button>
        )}
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
        {items.map((item) => (
          <ItemView key={item.id} item={item} />
        ))}
        {open.view.plan && <PlanView plan={open.view.plan} />}
        {busy && <div className="thinking" aria-label="Working" />}
        {open.queued.map((q, i) => (
          <div key={i} className="msg user queued">
            {q}
            <span className="muted small">Queued</span>
          </div>
        ))}
        {open.view.lastTurnError && <p className="error">{open.view.lastTurnError}</p>}
      </div>

      {pending && pending.method === USER_INPUT_METHOD && <UserInputSheet session={session} request={pending} />}
      {pending && pending.method !== USER_INPUT_METHOD && <ApprovalSheet session={session} approval={pending} />}

      <Composer session={session} disabled={open.state !== "ready"} busy={busy} />
    </main>
  );
}
