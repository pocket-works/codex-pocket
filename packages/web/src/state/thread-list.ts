import type { JsonRpcNotification, v2 } from "@codex-pocket/protocol";

export type ThreadStatus = "idle" | "active" | "unknown";

export interface ThreadSummary {
  id: string;
  cwd: string;
  title: string;
  /** First user message; shown when the thread has no name. */
  preview: string;
  /** Last real activity (Codex's recencyAt); updatedAt alone moves on every resume. */
  updatedAt: number;
  model: string | null;
  status: ThreadStatus;
  branch: string | null;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function title(name: string | null | undefined, preview: string): string {
  return clean(name ?? "") || clean(preview) || "(untitled)";
}

function status(s: v2.ThreadStatus): ThreadStatus {
  return s.type === "active" ? "active" : s.type === "idle" ? "idle" : "unknown";
}

export function summarize(t: v2.Thread): ThreadSummary {
  return {
    id: t.id,
    cwd: t.cwd,
    title: title(t.name, t.preview),
    preview: t.preview,
    updatedAt: (t.recencyAt ?? t.updatedAt) * 1000,
    model: t.model,
    status: status(t.status),
    branch: t.gitInfo?.branch ?? null,
  };
}

function sorted(list: ThreadSummary[]): ThreadSummary[] {
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Fresh page from `thread/list` wins over what we had; Codex may repeat ids. */
export function mergeThreadList(_current: ThreadSummary[], fresh: v2.Thread[]): ThreadSummary[] {
  const seen = new Set<string>();
  return sorted(fresh.filter((t) => !seen.has(t.id) && seen.add(t.id)).map(summarize));
}

function replace(list: ThreadSummary[], id: string, fn: (t: ThreadSummary) => ThreadSummary): ThreadSummary[] {
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return list;
  const next = list.slice();
  next[idx] = fn(list[idx]);
  return next;
}

// Pure: keeps the list in step with thread-level notifications so the phone
// sees what the desktop does without polling. `now` is injected for tests.
export function applyThreadListNotification(list: ThreadSummary[], n: JsonRpcNotification, now: number): ThreadSummary[] {
  switch (n.method) {
    case "thread/started": {
      const { thread } = n.params as v2.ThreadStartedNotification;
      if (list.some((t) => t.id === thread.id)) return list;
      return sorted([summarize(thread), ...list]);
    }
    case "thread/name/updated": {
      const { threadId, threadName } = n.params as v2.ThreadNameUpdatedNotification;
      return replace(list, threadId, (t) => ({ ...t, title: title(threadName, t.preview) }));
    }
    case "thread/archived":
    case "thread/deleted": {
      const { threadId } = n.params as v2.ThreadArchivedNotification;
      const next = list.filter((t) => t.id !== threadId);
      return next.length === list.length ? list : next;
    }
    case "thread/status/changed": {
      const p = n.params as v2.ThreadStatusChangedNotification;
      const next = status(p.status);
      const updated = replace(list, p.threadId, (t) => ({ ...t, status: next, updatedAt: next === "active" ? now : t.updatedAt }));
      return updated === list || next !== "active" ? updated : sorted(updated);
    }
    default:
      return list;
  }
}
