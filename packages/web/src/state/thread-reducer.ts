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

export interface ThreadViewState {
  threadId: string;
  /** Items in display order (oldest first). */
  items: ThreadItem[];
  activeTurnId: string | null;
  lastTurnError: string | null;
  approvals: PendingApproval[];
  /** Structured todo list for the current turn. */
  plan: TurnPlan | null;
  tokenUsage: TokenUsage | null;
  /** Transient notices for the current turn (warnings, reroutes, retries). */
  alerts: Alert[];
}

export function initialThreadState(threadId: string): ThreadViewState {
  return { threadId, items: [], activeTurnId: null, lastTurnError: null, approvals: [], plan: null, tokenUsage: null, alerts: [] };
}

let nextAlertId = 1;

function addAlert(state: ThreadViewState, kind: Alert["kind"], message: string): ThreadViewState {
  return { ...state, alerts: [...state.alerts, { id: nextAlertId++, kind, message }] };
}

export function dismissAlert(state: ThreadViewState, id: number): ThreadViewState {
  return { ...state, alerts: state.alerts.filter((a) => a.id !== id) };
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
      return { ...state, activeTurnId: turn.id, lastTurnError: null, plan: null, alerts: [] };
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
      return {
        ...state,
        activeTurnId: state.activeTurnId === turn.id ? null : state.activeTurnId,
        lastTurnError: turn.status === "failed" ? (turn.error?.message ?? "turn failed") : null,
      };
    }
    case "item/started":
    case "item/completed": {
      const item = (p as unknown as v2.ItemStartedNotification).item;
      return { ...state, items: upsert(state.items, item) };
    }
    case "item/agentMessage/delta": {
      const { itemId, delta } = p as unknown as v2.AgentMessageDeltaNotification;
      if (!state.items.some((i) => i.id === itemId)) {
        const placeholder: ThreadItem = { type: "agentMessage", id: itemId, text: delta, phase: null, memoryCitation: null, delivery: null, questions: null };
        return { ...state, items: [...state.items, placeholder] };
      }
      return { ...state, items: patch(state.items, itemId, (i) => (i.type === "agentMessage" ? withText(i, delta) : i)) };
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
  return { ...state, items: [...older, ...state.items] };
}
