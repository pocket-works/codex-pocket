import { useState } from "react";
import type { QueuedMessage } from "../state/queue.js";
import type { Session } from "../state/session.js";

// Follow-ups waiting on the app-server's queue, under the transcript. Each
// row can be sent now (steered into the running turn) or deleted. Codex only
// drains the queue after a turn that completed, so an idle thread with
// queued messages means the user interrupted: say so and offer Resume.
export function QueuedList({ session, queue, busy }: { session: Session; queue: QueuedMessage[]; busy: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<void>) {
    setPending(id);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="queued-list">
      <div className="queued-header muted small">
        <span>{busy ? "Queued" : "Queue paused because you interrupted"}</span>
        {!busy && (
          <button className="link-btn" disabled={pending !== null} onClick={() => void run("*", () => session.resumeQueue())}>
            Resume
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {queue.map((q) => (
        <div key={q.id} className="msg user queued">
          <span className="queued-text">
            {q.text || (q.imageCount > 0 ? "" : "(empty)")}
            {q.imageCount > 0 && <span className="muted small"> {q.imageCount === 1 ? "1 image" : `${q.imageCount} images`}</span>}
          </span>
          <span className="queued-actions">
            <button className="link-btn" disabled={pending !== null} title={busy ? "Submit without interrupting the model" : "Start now"} onClick={() => void run(q.id, () => session.sendQueuedNow(q.id))}>
              {busy ? "Steer" : "Send now"}
            </button>
            <button className="icon-btn" aria-label="Delete queued message" disabled={pending !== null} onClick={() => void run(q.id, () => session.deleteQueued(q.id))}>
              ×
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
