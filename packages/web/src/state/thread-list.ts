import type { JsonRpcNotification, v2 } from "@codex-pocket/protocol";

/**
 * What the list shows beside a thread. Mirrors the official ChatGPT desktop
 * sidebar, which splits Codex's `ThreadStatus` into "working" and "blocked on
 * you": a spinner means a turn is running, amber means it is waiting for an
 * approval or an answer, red means the thread hit a system error, and green
 * means a turn finished while you were not looking. Green never means "busy".
 */
export type ThreadStatus = "idle" | "running" | "waiting" | "error" | "unknown";

/** Which kind of input an `active` thread is blocked on. */
export type WaitingFor = "approval" | "input";

export interface ThreadAgentInfo {
  parentThreadId?: string | null;
  isSubagent?: boolean;
  canAcceptDirectInput?: boolean | null;
  agentNickname?: string | null;
  agentRole?: string | null;
}

export interface ThreadSummary extends ThreadAgentInfo {
  id: string;
  cwd: string;
  /**
   * Canonical project assignment from app-server (`Thread.projectId`); null
   * for project-less chats and whenever the app-server has no assignment.
   */
  projectId: string | null;
  title: string;
  /** First user message; shown when the thread has no name. */
  preview: string;
  /** Last real activity (Codex's recencyAt); updatedAt alone moves on every resume. */
  updatedAt: number;
  model: string | null;
  status: ThreadStatus;
  /** Set only while `status` is "waiting". */
  waitingFor: WaitingFor | null;
  /** A turn finished since we last opened this thread ("Ready" in the official app). */
  unread: boolean;
  branch: string | null;
  /** Codex holds a name for it (as opposed to the title being its first message). */
  named: boolean;
}

export function isSubagent(thread: ThreadAgentInfo): boolean {
  return thread.isSubagent === true || thread.parentThreadId != null;
}

export function canAcceptInput(thread: ThreadAgentInfo): boolean {
  return thread.canAcceptDirectInput ?? !isSubagent(thread);
}

export function subagentsForParent(threads: ThreadSummary[], parentThreadId: string): ThreadSummary[] {
  const parents = new Map(threads.map((thread) => [thread.id, thread.parentThreadId]));
  return threads.filter((thread) => {
    if (thread.id === parentThreadId) return false;
    const visited = new Set([thread.id]);
    let parent = thread.parentThreadId;
    while (parent && !visited.has(parent)) {
      if (parent === parentThreadId) return true;
      visited.add(parent);
      parent = parents.get(parent);
    }
    return false;
  });
}

export function threadAgentInfo(thread: v2.Thread): ThreadAgentInfo {
  const source = thread.source;
  const child = typeof source === "object" && source !== null && "subAgent" in source;
  const spawned = child && typeof source.subAgent === "object" && "thread_spawn" in source.subAgent ? source.subAgent.thread_spawn : null;
  const parentThreadId = thread.parentThreadId ?? spawned?.parent_thread_id ?? null;
  return {
    parentThreadId,
    isSubagent: child || parentThreadId !== null,
    canAcceptDirectInput: thread.canAcceptDirectInput ?? null,
    agentNickname: thread.agentNickname ?? spawned?.agent_nickname ?? null,
    agentRole: thread.agentRole ?? spawned?.agent_role ?? null,
  };
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function title(name: string | null | undefined, preview: string): string {
  return clean(name ?? "") || clean(preview) || "(untitled)";
}

function readStatus(s: v2.ThreadStatus): Pick<ThreadSummary, "status" | "waitingFor"> {
  switch (s.type) {
    case "active":
      // `activeFlags` is the difference between a turn that is really working
      // and one stopped at an approval or a question. Older app-server builds
      // omit the field entirely, which just means "plainly working".
      const flags = s.activeFlags ?? [];
      if (flags.includes("waitingOnApproval")) return { status: "waiting", waitingFor: "approval" };
      if (flags.includes("waitingOnUserInput")) return { status: "waiting", waitingFor: "input" };
      return { status: "running", waitingFor: null };
    case "idle":
      return { status: "idle", waitingFor: null };
    case "systemError":
      return { status: "error", waitingFor: null };
    case "notLoaded":
      return { status: "unknown", waitingFor: null };
  }
}

export function summarize(t: v2.Thread, unread = false): ThreadSummary {
  const preview = t.preview ?? "";
  return {
    ...threadAgentInfo(t),
    id: t.id,
    cwd: t.cwd,
    projectId: t.projectId ?? null,
    title: title(t.name, preview),
    preview,
    updatedAt: (t.recencyAt ?? t.updatedAt ?? 0) * 1000,
    model: t.model,
    ...readStatus(t.status ?? { type: "notLoaded" }),
    unread,
    named: clean(t.name ?? "") !== "",
    branch: t.gitInfo?.branch ?? null,
  };
}

/** Merge a partial response without discarding other threads or live children. */
export function upsertThreadList(current: ThreadSummary[], fresh: v2.Thread[]): ThreadSummary[] {
  const updates = mergeThreadList(current, fresh);
  const ids = new Set(updates.map((thread) => thread.id));
  return sorted([...updates, ...current.filter((thread) => !ids.has(thread.id))]);
}

function sorted(list: ThreadSummary[]): ThreadSummary[] {
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Fresh page from `thread/list` wins over what we had; Codex may repeat ids.
 * `thread/list` cannot report unread state, so carry ours over by id.
 */
export function mergeThreadList(current: ThreadSummary[], fresh: v2.Thread[]): ThreadSummary[] {
  const seen = new Set<string>();
  const unread = new Map(current.map((t) => [t.id, t.unread]));
  return sorted(fresh.filter((t) => !seen.has(t.id) && seen.add(t.id)).map((t) => summarize(t, unread.get(t.id) ?? false)));
}

function replace(list: ThreadSummary[], id: string, fn: (t: ThreadSummary) => ThreadSummary): ThreadSummary[] {
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return list;
  const next = fn(list[idx]);
  if (next === list[idx]) return list;
  const copy = list.slice();
  copy[idx] = next;
  return copy;
}

/**
 * Titles a nameless thread after its first message, the way the official
 * sidebar does. A thread started from here arrives with an empty preview and
 * would only get one from the next `thread/list`, so it read "(untitled)"
 * for as long as you were looking at it — and stayed that way when the
 * message was too short to be worth naming.
 */
export function withFirstMessage(list: ThreadSummary[], threadId: string, content: v2.UserInput[]): ThreadSummary[] {
  const text = clean(content.map((c) => (c.type === "text" ? c.text : "")).join(""));
  if (!text) return list;
  return replace(list, threadId, (t) => (t.preview !== "" ? t : { ...t, preview: text, title: t.named ? t.title : title(null, text) }));
}

/** Clears the "Ready" marker once the user is actually looking at the thread. */
export function markRead(list: ThreadSummary[], id: string): ThreadSummary[] {
  return replace(list, id, (t) => (t.unread ? { ...t, unread: false } : t));
}

// Pure: keeps the list in step with thread-level notifications so the phone
// sees what the desktop does without polling. `now` is injected for tests.
export function applyThreadListNotification(list: ThreadSummary[], n: JsonRpcNotification, now: number): ThreadSummary[] {
  switch (n.method) {
    case "thread/started": {
      const { thread } = n.params as v2.ThreadStartedNotification;
      // Ephemeral threads (title generation, side work) never reach the list.
      if (thread.ephemeral || list.some((t) => t.id === thread.id)) return list;
      return sorted([summarize(thread), ...list]);
    }
    case "turn/started": {
      // A new turn means the user is engaged again; the old result is no longer news.
      const { threadId } = n.params as v2.TurnStartedNotification;
      return replace(list, threadId, (t) => (t.unread ? { ...t, unread: false } : t));
    }
    case "turn/completed": {
      // Matches the official "Ready" state: green once a turn lands while the
      // phone is not showing that thread. A failed turn already surfaces an error.
      const { threadId, turn } = n.params as v2.TurnCompletedNotification;
      if (turn.status !== "completed") return list;
      return replace(list, threadId, (t) => (t.unread ? t : { ...t, unread: true }));
    }
    case "item/started":
    case "item/completed": {
      // The first message of a thread the desktop started reaches us as an
      // echo rather than through `sendMessage`.
      const { threadId, item } = n.params as v2.ItemStartedNotification;
      return item.type === "userMessage" ? withFirstMessage(list, threadId, item.content) : list;
    }
    case "thread/name/updated": {
      const { threadId, threadName } = n.params as v2.ThreadNameUpdatedNotification;
      return replace(list, threadId, (t) => ({ ...t, title: title(threadName, t.preview), named: clean(threadName ?? "") !== "" }));
    }
    case "thread/archived":
    case "thread/deleted": {
      const { threadId } = n.params as v2.ThreadArchivedNotification;
      const next = list.filter((t) => t.id !== threadId);
      return next.length === list.length ? list : next;
    }
    case "thread/project/updated": {
      // The desktop can move a thread between projects; follow it so the
      // phone's grouping matches without a refresh.
      const { threadId, projectId } = n.params as v2.ThreadProjectUpdatedNotification;
      return replace(list, threadId, (t) => (t.projectId === projectId ? t : { ...t, projectId }));
    }
    case "thread/status/changed": {
      const p = n.params as v2.ThreadStatusChangedNotification;
      const next = readStatus(p.status);
      // Running and waiting threads float to the top: those are the ones that
      // want your attention, exactly as the official sidebar orders them.
      const busy = next.status === "running" || next.status === "waiting";
      const changed = list.some((t) => t.id === p.threadId && (t.status !== next.status || t.waitingFor !== next.waitingFor));
      const updated = replace(list, p.threadId, (t) =>
        t.status === next.status && t.waitingFor === next.waitingFor ? t : { ...t, ...next, updatedAt: busy ? now : t.updatedAt },
      );
      return changed && busy ? sorted(updated) : updated;
    }
    default:
      return list;
  }
}
