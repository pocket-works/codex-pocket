import { useEffect, useId, useMemo, useState } from "react";
import type { Session, ThreadSummary } from "../state/session.js";
import { subagentsForParent } from "../state/thread-list.js";
import { useStore } from "../state/store.js";
import { friendlyError } from "../state/errors.js";
import { useDialog } from "./dialog.js";
import { useSheetDrag } from "./gestures.js";
import { UsersIcon, ChevronIcon } from "./icons.js";
import { navigate } from "./route.js";
import { relativeTime, useMinuteTick } from "./ThreadList.js";

function useSubagents(session: Session, parentThreadId: string) {
  const threads = useStore(session.store, (s) => s.threads);
  return useMemo(() => subagentsForParent(threads, parentThreadId), [threads, parentThreadId]);
}

export function SubagentsEntry({ session, parentThreadId, connected, expanded }: { session: Session; parentThreadId: string; connected: boolean; expanded: boolean }) {
  const agents = useSubagents(session, parentThreadId);
  const statusId = useId();
  useEffect(() => {
    if (!connected) return;
    const refresh = () => {
      void session.loadSubagents(parentThreadId).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [session, parentThreadId, connected]);

  if (agents.length === 0) return null;
  const working = agents.filter((agent) => agent.status === "running").length;
  const waiting = agents.filter((agent) => agent.status === "waiting").length;
  const done = agents.filter((agent) => agent.status === "idle" || agent.status === "error").length;
  const errors = agents.filter((agent) => agent.status === "error").length;
  const counts = [working ? `${working} working` : "", waiting ? `${waiting} waiting` : "", done ? `${done} done` : ""].filter(Boolean).join(" · ");
  const summary = waiting ? `${waiting} waiting` : working ? `${working} working` : errors ? `${errors} failed` : done ? `${done} done` : `${agents.length} not loaded`;
  return (
    <button className="subagents-entry" aria-label="Open subagents" aria-describedby={statusId} title={`${agents.length} subagents: ${counts || summary}`} aria-expanded={expanded} onClick={() => navigate({ name: "thread", id: parentThreadId, subagents: true })}>
      {working > 0 ? <span className="spinner" aria-hidden /> : <UsersIcon size={16} />}
      <span className="subagents-entry-label">Subagents</span>
      <span className={`subagents-entry-status small ${waiting ? "waiting" : errors && !working ? "error" : "muted"}`} aria-hidden>{summary}</span>
      <span className="sr-only" id={statusId}>{agents.length} subagents: {counts || summary}</span>
    </button>
  );
}

export function SubagentsSheet({ session, parentThreadId, onClose }: { session: Session; parentThreadId: string; onClose: () => void }) {
  const agents = useSubagents(session, parentThreadId);
  const connected = useStore(session.store, (s) => s.connection === "open" && s.upstreamConnected);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const dialog = useDialog("Subagents", onClose);
  const drag = useSheetDrag(onClose);
  useMinuteTick();

  useEffect(() => {
    if (!connected) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    void session.loadSubagents(parentThreadId).catch((err: unknown) => { if (alive) setError(friendlyError(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, parentThreadId, connected, retry]);

  const active = agents.filter((agent) => agent.status === "running" || agent.status === "waiting");
  const done = agents.filter((agent) => agent.status === "idle" || agent.status === "error");
  const unloaded = agents.filter((agent) => agent.status === "unknown");
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div ref={dialog.ref} {...dialog.props} className={`sheet subagents-sheet ${drag.dragging ? "dragging" : ""}`} style={drag.style} onClick={(event) => event.stopPropagation()} {...drag.handlers}>
        <div className="sheet-grip" />
        <header className="subagents-heading">
          <h2>Subagents</h2>
          <button className="icon-btn" aria-label="Close subagents" title="Close subagents" onClick={onClose}>×</button>
        </header>
        {!connected && <p className="muted small" role="status">Disconnected</p>}
        {error && <div className="subagents-error"><p className="error" role="alert">{error}</p><button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
        {loading && agents.length === 0 && <p className="muted center" role="status">Loading…</p>}
        {!loading && !error && agents.length === 0 && <p className="muted center">No subagents.</p>}
        <AgentSection title="Active" agents={active} />
        <AgentSection title="Done" agents={done} />
        {unloaded.length > 0 && <AgentSection title="Not loaded" agents={unloaded} />}
      </div>
    </div>
  );
}

function AgentSection({ title, agents }: { title: string; agents: ThreadSummary[] }) {
  return (
    <section className="subagents-section">
      <h3>{title} · {agents.length}</h3>
      {agents.length === 0 && <p className="muted small">{title === "Active" ? "No active subagents." : "No completed subagents."}</p>}
      <ul className="subagent-list">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button className="subagent-row" onClick={() => navigate({ name: "thread", id: agent.id })}>
              <span className={`subagent-mark ${agent.status}`} aria-hidden><UsersIcon size={18} /></span>
              <span className="subagent-body">
                <span className="subagent-title">{agent.agentNickname || agent.title}</span>
                {agent.preview && <span className="subagent-preview muted small">{agent.preview}</span>}
                {(agent.agentRole || agent.model) && <span className="subagent-model muted small">{[agent.agentRole, agent.model].filter(Boolean).join(" · ")}</span>}
              </span>
              <span className={`subagent-status small ${agent.status}`}>
                {agent.status === "running" ? "Working" : agent.status === "waiting" ? "Waiting" : agent.status === "error" ? "Failed" : agent.status === "unknown" ? "Not loaded" : "Done"}
                <span className="muted">{relativeTime(agent.updatedAt)}</span>
              </span>
              <ChevronIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
