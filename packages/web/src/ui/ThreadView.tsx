import { useEffect, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { ApprovalSheet } from "./ApprovalSheet.js";
import { ItemView } from "./ItemView.js";
import { ModelPicker } from "./ModelPicker.js";
import { navigate } from "./route.js";

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

  return (
    <main className="screen thread">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <div className="topbar-title">
          <h1>{open.cwd.split("/").filter(Boolean).pop() ?? "Thread"}</h1>
          <ModelPicker session={session} />
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

      <div className="items" ref={listRef} onScroll={onScroll}>
        {open.loadingOlder && <p className="muted center">Loading…</p>}
        {open.state === "loading" && items.length === 0 && <p className="muted center">Loading…</p>}
        {items.map((item) => (
          <ItemView key={item.id} item={item} />
        ))}
        {busy && <div className="thinking" aria-label="Working" />}
        {open.view.lastTurnError && <p className="error">{open.view.lastTurnError}</p>}
      </div>

      {open.view.approvals.length > 0 && <ApprovalSheet session={session} approval={open.view.approvals[0]} />}

      <Composer session={session} disabled={open.state !== "ready"} />
    </main>
  );
}

function Composer({ session, disabled }: { session: Session; disabled: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await session.sendMessage(body);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      {error && <p className="error">{error}</p>}
      <div className="composer-row">
        <textarea
          value={text}
          rows={1}
          placeholder={disabled ? "Thread not ready" : "Message Codex…"}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="primary" onClick={() => void send()} disabled={disabled || sending || !text.trim()} aria-label="Send">
          ↑
        </button>
      </div>
    </div>
  );
}
