import type { JsonRpcNotification, JsonRpcRequest, v2 } from "@codex-pocket/protocol";

export type ThreadItem = v2.ThreadItem;

export interface PendingApproval {
  id: JsonRpcRequest["id"];
  method: string;
  params: Record<string, unknown>;
}

export interface TurnPlan {
  explanation: string | null;
  steps: v2.TurnPlanStep[];
}

export interface TokenUsage {
  /** Tokens the last turn carried in context, i.e. how full the window is. */
  contextTokens: number;
  contextWindow: number | null;
}

export interface Alert {
  id: number;
  kind: "info" | "warning";
  message: string;
}

export interface TurnMeta {
  id: string;
  status: v2.TurnStatus;
  /** Epoch ms. */
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

/** A message the phone sent that Codex has not echoed back as an item yet. */
export interface PendingMessage {
  id: string;
  input: v2.UserInput[];
}

export interface ThreadViewState {
  threadId: string;
  /** Items in display order (oldest first). */
  items: ThreadItem[];
  /** Sent messages shown at the end of the transcript until their item arrives. */
  pending: PendingMessage[];
  /** itemId -> turnId, so items can be grouped per turn. */
  itemTurns: Record<string, string>;
  turns: Record<string, TurnMeta>;
  activeTurnId: string | null;
  lastTurnError: string | null;
  approvals: PendingApproval[];
  /** Structured todo list for the current turn. */
  plan: TurnPlan | null;
  tokenUsage: TokenUsage | null;
  /** Transient notices for the current turn (warnings, reroutes, retries). */
  alerts: Alert[];
  /** Latest progress line per running MCP tool call, by item id. */
  toolProgress: Record<string, string>;
}

export function initialThreadState(threadId: string): ThreadViewState {
  return { threadId, items: [], pending: [], itemTurns: {}, turns: {}, activeTurnId: null, lastTurnError: null, approvals: [], plan: null, tokenUsage: null, alerts: [], toolProgress: {} };
}

export function addPending(state: ThreadViewState, message: PendingMessage): ThreadViewState {
  return { ...state, pending: [...state.pending, message] };
}

export function removePending(state: ThreadViewState, id: string): ThreadViewState {
  return state.pending.some((m) => m.id === id) ? { ...state, pending: state.pending.filter((m) => m.id !== id) } : state;
}

let nextAlertId = 1;

function addAlert(state: ThreadViewState, kind: Alert["kind"], message: string): ThreadViewState {
  return { ...state, alerts: [...state.alerts, { id: nextAlertId++, kind, message }] };
}

export function dismissAlert(state: ThreadViewState, id: number): ThreadViewState {
  return { ...state, alerts: state.alerts.filter((a) => a.id !== id) };
}

// Codex reports turn timestamps in epoch seconds; normalise to ms.
function toMs(t: number | null): number | null {
  return t === null ? null : t < 1e12 ? t * 1000 : t;
}

function turnMeta(turn: v2.Turn): TurnMeta {
  return { id: turn.id, status: turn.status, startedAt: toMs(turn.startedAt), completedAt: toMs(turn.completedAt), durationMs: turn.durationMs };
}

function withTurn(state: ThreadViewState, itemId: string, turnId: string | undefined): ThreadViewState {
  if (!turnId || state.itemTurns[itemId] === turnId) return state;
  return { ...state, itemTurns: { ...state.itemTurns, [itemId]: turnId } };
}

function upsert(items: ThreadItem[], item: ThreadItem): ThreadItem[] {
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx < 0) return [...items, item];
  const next = items.slice();
  next[idx] = item;
  return next;
}

function patch(items: ThreadItem[], itemId: string, fn: (item: ThreadItem) => ThreadItem): ThreadItem[] {
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return items;
  const next = items.slice();
  next[idx] = fn(items[idx]);
  return next;
}

function withText<T extends { text: string }>(item: T, delta: string): T {
  return { ...item, text: item.text + delta };
}

function appendAt(list: string[], index: number, delta: string): string[] {
  const next = list.slice();
  while (next.length <= index) next.push("");
  next[index] += delta;
  return next;
}

// Pure: applies one Codex notification to a thread view. Notifications for
// other threads are ignored so one reducer can sit behind a global stream.
export function applyNotification(state: ThreadViewState, n: JsonRpcNotification): ThreadViewState {
  const p = (n.params ?? {}) as Record<string, unknown> & { threadId?: string; itemId?: string; delta?: string };
  if (p.threadId !== undefined && p.threadId !== state.threadId) return state;

  switch (n.method) {
    case "turn/started": {
      const turn = (p as unknown as v2.TurnStartedNotification).turn;
      const meta = turnMeta(turn);
      if (meta.startedAt === null) meta.startedAt = Date.now();
      return { ...state, activeTurnId: turn.id, lastTurnError: null, plan: null, alerts: [], turns: { ...state.turns, [turn.id]: meta } };
    }
    case "turn/plan/updated": {
      const { explanation, plan } = p as unknown as v2.TurnPlanUpdatedNotification;
      return { ...state, plan: { explanation, steps: plan } };
    }
    case "thread/tokenUsage/updated": {
      const { tokenUsage } = p as unknown as v2.ThreadTokenUsageUpdatedNotification;
      return { ...state, tokenUsage: { contextTokens: tokenUsage.last.totalTokens, contextWindow: tokenUsage.modelContextWindow } };
    }
    case "error": {
      const { error, willRetry } = p as unknown as v2.ErrorNotification;
      return willRetry ? addAlert(state, "warning", `${error.message} — retrying`) : { ...state, lastTurnError: error.message };
    }
    case "warning": {
      const { message } = p as unknown as v2.WarningNotification;
      return addAlert(state, "warning", message);
    }
    case "model/rerouted": {
      const { fromModel, toModel, reason } = p as unknown as v2.ModelReroutedNotification;
      return addAlert(state, "info", `Model switched from ${fromModel} to ${toModel} (${reason})`);
    }
    case "turn/completed": {
      const turn = (p as unknown as v2.TurnCompletedNotification).turn;
      const prev = state.turns[turn.id];
      const meta = turnMeta(turn);
      if (meta.startedAt === null) meta.startedAt = prev?.startedAt ?? null;
      if (meta.completedAt === null) meta.completedAt = Date.now();
      if (meta.durationMs === null && meta.startedAt !== null) meta.durationMs = meta.completedAt - meta.startedAt;
      // One turn runs per thread, so whichever id completed, nothing is
      // running now. (A review's items, turn/started and turn/completed do
      // not even agree on one id; matching strictly left the composer stuck
      // on Stop after a review.)
      return {
        ...state,
        activeTurnId: null,
        lastTurnError: turn.status === "failed" ? (turn.error?.message ?? "turn failed") : null,
        turns: { ...state.turns, [turn.id]: meta },
      };
    }
    case "item/started":
    case "item/completed": {
      const { item, turnId } = p as unknown as v2.ItemStartedNotification;
      let next = withTurn({ ...state, items: upsert(state.items, item) }, item.id, turnId);
      // Codex echoes what we sent in order, so the first pending message is
      // the one this user item stands for.
      if (item.type === "userMessage" && next.pending.length > 0 && !state.items.some((i) => i.id === item.id)) next = { ...next, pending: next.pending.slice(1) };
      if (n.method === "item/completed" && item.id in next.toolProgress) {
        const { [item.id]: _done, ...toolProgress } = next.toolProgress;
        next = { ...next, toolProgress };
      }
      return next;
    }
    case "item/mcpToolCall/progress": {
      const { itemId, message } = p as unknown as v2.McpToolCallProgressNotification;
      return { ...state, toolProgress: { ...state.toolProgress, [itemId]: message } };
    }
    case "item/agentMessage/delta": {
      const { itemId, delta, turnId } = p as unknown as v2.AgentMessageDeltaNotification;
      if (!state.items.some((i) => i.id === itemId)) {
        const placeholder: ThreadItem = { type: "agentMessage", id: itemId, text: delta, phase: null, memoryCitation: null, delivery: null, questions: null };
        return withTurn({ ...state, items: [...state.items, placeholder] }, itemId, turnId);
      }
      return withTurn({ ...state, items: patch(state.items, itemId, (i) => (i.type === "agentMessage" ? withText(i, delta) : i)) }, itemId, turnId);
    }
    case "item/plan/delta": {
      const { itemId, delta } = p as unknown as v2.PlanDeltaNotification;
      return { ...state, items: patch(state.items, itemId, (i) => (i.type === "plan" ? withText(i, delta) : i)) };
    }
    case "item/reasoning/summaryTextDelta": {
      const { itemId, delta, summaryIndex } = p as unknown as v2.ReasoningSummaryTextDeltaNotification;
      return {
        ...state,
        items: patch(state.items, itemId, (i) => (i.type === "reasoning" ? { ...i, summary: appendAt(i.summary, summaryIndex, delta) } : i)),
      };
    }
    case "item/reasoning/textDelta": {
      const { itemId, delta, contentIndex } = p as unknown as v2.ReasoningTextDeltaNotification;
      return {
        ...state,
        items: patch(state.items, itemId, (i) => (i.type === "reasoning" ? { ...i, content: appendAt(i.content, contentIndex, delta) } : i)),
      };
    }
    case "item/fileChange/patchUpdated": {
      const { itemId, changes } = p as unknown as v2.FileChangePatchUpdatedNotification;
      return { ...state, items: patch(state.items, itemId, (i) => (i.type === "fileChange" ? { ...i, changes } : i)) };
    }
    case "item/commandExecution/outputDelta": {
      const { itemId, delta } = p as unknown as v2.CommandExecutionOutputDeltaNotification;
      return {
        ...state,
        items: patch(state.items, itemId, (i) =>
          i.type === "commandExecution" ? { ...i, aggregatedOutput: (i.aggregatedOutput ?? "") + delta } : i,
        ),
      };
    }
    case "serverRequest/resolved": {
      const { requestId } = p as unknown as v2.ServerRequestResolvedNotification;
      return { ...state, approvals: state.approvals.filter((a) => a.id !== requestId) };
    }
    default:
      return state;
  }
}

// Server-initiated requests that need a human decision. Anything else the
// phone cannot answer is left for other clients (or the host's timeout).
export const USER_INPUT_METHOD = "item/tool/requestUserInput";
const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  USER_INPUT_METHOD,
]);

export function applyServerRequest(state: ThreadViewState, req: JsonRpcRequest): ThreadViewState {
  if (!APPROVAL_METHODS.has(req.method)) return state;
  const params = (req.params ?? {}) as Record<string, unknown> & { threadId?: string };
  if (params.threadId !== state.threadId) return state;
  if (state.approvals.some((a) => a.id === req.id)) return state;
  return { ...state, approvals: [...state.approvals, { id: req.id, method: req.method, params }] };
}

export function removeApproval(state: ThreadViewState, id: JsonRpcRequest["id"]): ThreadViewState {
  return { ...state, approvals: state.approvals.filter((a) => a.id !== id) };
}

/** Merge a page of history (oldest first) in front of what we have. */
export function prependHistory(state: ThreadViewState, entries: v2.ThreadItemEntry[]): ThreadViewState {
  const known = new Set(state.items.map((i) => i.id));
  const older = entries.map((e) => e.item).filter((i) => !known.has(i.id));
  const itemTurns = { ...state.itemTurns };
  for (const e of entries) itemTurns[e.item.id] = e.turnId;
  return { ...state, items: [...older, ...state.items], itemTurns };
}

/** Record timing/status for turns from `thread/turns/list`. */
export function mergeTurns(state: ThreadViewState, turns: v2.Turn[]): ThreadViewState {
  if (turns.length === 0) return state;
  const next = { ...state.turns };
  for (const t of turns) {
    const prev = next[t.id];
    // A live turn we are already tracking keeps its in-progress status.
    if (prev && prev.status === "inProgress" && state.activeTurnId === t.id) continue;
    next[t.id] = turnMeta(t);
  }
  return { ...state, turns: next };
}
