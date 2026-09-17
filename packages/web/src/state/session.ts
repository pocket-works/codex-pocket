import type { JsonRpcNotification, JsonRpcRequest, ReasoningEffort, v2 } from "@codex-pocket/protocol";
import { RpcClient, RpcError, type ConnectionState } from "../rpc/client.js";
import { createStore, type Store } from "./store.js";
import {
  applyNotification,
  applyServerRequest,
  dismissAlert,
  initialThreadState,
  prependHistory,
  removeApproval,
  type ThreadViewState,
} from "./thread-reducer.js";
import { applyThreadListNotification, mergeThreadList, type ThreadSummary } from "./thread-list.js";

export type { ThreadStatus, ThreadSummary } from "./thread-list.js";

export interface RateLimitWindow {
  usedPercent: number;
  /** Window length in minutes, e.g. 300 for the 5h window. */
  durationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimits {
  /** Short window (e.g. 5h) and long window (e.g. weekly); either may be absent. */
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}

export interface Notice {
  id: number;
  message: string;
}

export type OpenState = "loading" | "ready" | "locked" | "error";

export interface OpenThread {
  view: ThreadViewState;
  state: OpenState;
  error: string | null;
  /** Model/effort the thread currently runs with (from resume/start). */
  model: string;
  effort: ReasoningEffort | null;
  /** Pending user choice for the next turn; null means keep the thread's. */
  override: { model: string; effort: ReasoningEffort | null } | null;
  cwd: string;
  olderCursor: string | null;
  loadingOlder: boolean;
}

export interface SessionState {
  connection: ConnectionState;
  upstreamConnected: boolean;
  threads: ThreadSummary[];
  threadsLoading: boolean;
  threadsError: string | null;
  models: v2.Model[];
  open: OpenThread | null;
  /** Account-wide usage, null until read. */
  rateLimits: RateLimits | null;
  /** Warnings not tied to a thread; shown app-wide until dismissed. */
  notices: Notice[];
}

const HISTORY_PAGE = 40;

let nextNoticeId = 1;

function rateLimitWindow(w: v2.RateLimitWindow | null): RateLimitWindow | null {
  return w ? { usedPercent: w.usedPercent, durationMins: w.windowDurationMins, resetsAt: w.resetsAt } : null;
}

function rateLimits(snapshot: v2.RateLimitSnapshot): RateLimits {
  return { primary: rateLimitWindow(snapshot.primary), secondary: rateLimitWindow(snapshot.secondary) };
}

function isLockedError(err: unknown): boolean {
  return err instanceof RpcError && /active writer/i.test(err.message);
}

// Everything the UI can do, on top of one RpcClient. State is in `store`.
export class Session {
  readonly store: Store<SessionState>;
  private readonly rpc: RpcClient;
  private openGeneration = 0;

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
    this.store = createStore<SessionState>({
      connection: rpc.connectionState,
      upstreamConnected: false,
      threads: [],
      threadsLoading: false,
      threadsError: null,
      models: [],
      open: null,
      rateLimits: null,
      notices: [],
    });
    rpc.onStateChange((connection) => {
      this.store.set((s) => ({ ...s, connection, upstreamConnected: connection === "open" ? s.upstreamConnected : false }));
      if (connection === "open") this.onReconnected();
    });
    rpc.onNotification((n) => this.onNotification(n));
    rpc.onServerRequest((req) => this.onServerRequest(req));
  }

  start(): void {
    this.rpc.start();
  }

  // --- thread list --------------------------------------------------------

  async loadThreads(): Promise<void> {
    this.store.set((s) => ({ ...s, threadsLoading: true, threadsError: null }));
    try {
      const res = await this.rpc.request<v2.ThreadListResponse>("thread/list", { limit: 60, sortKey: "updated_at" });
      this.store.set((s) => ({ ...s, threads: mergeThreadList(s.threads, res.data), threadsLoading: false }));
    } catch (err) {
      this.store.set((s) => ({ ...s, threadsLoading: false, threadsError: describe(err) }));
    }
  }

  async loadRateLimits(): Promise<void> {
    try {
      const res = await this.rpc.request<v2.GetAccountRateLimitsResponse>("account/rateLimits/read", {});
      this.store.set((s) => ({ ...s, rateLimits: rateLimits(res.rateLimits) }));
    } catch {
      // Not signed in with ChatGPT, or an older Codex: the badge just stays hidden.
    }
  }

  dismissNotice(id: number): void {
    this.store.set((s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) }));
  }

  dismissAlert(id: number): void {
    this.store.set((s) => (s.open ? { ...s, open: { ...s.open, view: dismissAlert(s.open.view, id) } } : s));
  }

  /** Distinct working directories from recent threads, most recent first. */
  knownCwds(): string[] {
    const out: string[] = [];
    for (const t of this.store.get().threads) if (!out.includes(t.cwd)) out.push(t.cwd);
    return out;
  }

  async loadModels(): Promise<void> {
    if (this.store.get().models.length > 0) return;
    const res = await this.rpc.request<v2.ModelListResponse>("model/list", {});
    this.store.set((s) => ({ ...s, models: res.data.filter((m) => !m.hidden) }));
  }

  // --- open thread --------------------------------------------------------

  async openThread(threadId: string, opts: { force?: boolean } = {}): Promise<void> {
    const current = this.store.get().open;
    // A thread we just started is already live; resuming it would fail
    // because Codex has not written its rollout yet.
    if (!opts.force && current?.view.threadId === threadId && current.state === "ready") return;
    const generation = ++this.openGeneration;
    if (current && current.view.threadId !== threadId) void this.unsubscribe(current.view.threadId);
    this.store.set((s) => ({
      ...s,
      open: {
        view: current?.view.threadId === threadId ? current.view : initialThreadState(threadId),
        state: "loading",
        error: null,
        model: current?.model ?? "",
        effort: current?.effort ?? null,
        override: current?.override ?? null,
        cwd: current?.cwd ?? "",
        olderCursor: null,
        loadingOlder: false,
      },
    }));
    try {
      const resumed = await this.rpc.request<v2.ThreadResumeResponse>("thread/resume", { threadId, excludeTurns: true });
      if (generation !== this.openGeneration) return;
      const page = await this.rpc.request<v2.ThreadItemsListResponse>("thread/items/list", {
        threadId,
        limit: HISTORY_PAGE,
        sortDirection: "desc",
      });
      if (generation !== this.openGeneration) return;
      this.store.set((s) => {
        if (!s.open || s.open.view.threadId !== threadId) return s;
        // History replaces what we had: after a reconnect it is the truth.
        const fresh = prependHistory(initialThreadState(threadId), page.data.slice().reverse());
        const view: ThreadViewState = { ...fresh, approvals: s.open.view.approvals };
        return {
          ...s,
          open: {
            ...s.open,
            view,
            state: "ready",
            model: resumed.model,
            effort: resumed.reasoningEffort,
            cwd: resumed.cwd,
            olderCursor: page.nextCursor,
          },
        };
      });
    } catch (err) {
      if (generation !== this.openGeneration) return;
      this.store.set((s) =>
        s.open && s.open.view.threadId === threadId
          ? { ...s, open: { ...s.open, state: isLockedError(err) ? "locked" : "error", error: describe(err) } }
          : s,
      );
    }
  }

  async loadOlder(): Promise<void> {
    const open = this.store.get().open;
    if (!open || !open.olderCursor || open.loadingOlder) return;
    const threadId = open.view.threadId;
    this.store.set((s) => (s.open ? { ...s, open: { ...s.open, loadingOlder: true } } : s));
    try {
      const page = await this.rpc.request<v2.ThreadItemsListResponse>("thread/items/list", {
        threadId,
        cursor: open.olderCursor,
        limit: HISTORY_PAGE,
        sortDirection: "desc",
      });
      this.store.set((s) =>
        s.open && s.open.view.threadId === threadId
          ? { ...s, open: { ...s.open, view: prependHistory(s.open.view, page.data.slice().reverse()), olderCursor: page.nextCursor, loadingOlder: false } }
          : s,
      );
    } catch {
      this.store.set((s) => (s.open ? { ...s, open: { ...s.open, loadingOlder: false } } : s));
    }
  }

  async closeThread(): Promise<void> {
    const open = this.store.get().open;
    this.openGeneration++;
    this.store.set((s) => ({ ...s, open: null }));
    if (open) await this.unsubscribe(open.view.threadId);
  }

  private async unsubscribe(threadId: string): Promise<void> {
    try {
      await this.rpc.request("thread/unsubscribe", { threadId });
    } catch {
      // Not connected or not subscribed: nothing to release.
    }
  }

  // --- turns --------------------------------------------------------------

  async interrupt(): Promise<void> {
    const open = this.store.get().open;
    if (!open || !open.view.activeTurnId) return;
    await this.rpc.request("turn/interrupt", { threadId: open.view.threadId, turnId: open.view.activeTurnId });
  }

  // Model/effort are turn overrides that stick for subsequent turns, so they
  // are applied on the next turn/start rather than through a separate call.
  setModel(model: string, effort: ReasoningEffort | null): void {
    this.store.set((s) => {
      if (!s.open) return s;
      const same = model === s.open.model && effort === s.open.effort;
      return { ...s, open: { ...s.open, override: same ? null : { model, effort } } };
    });
  }

  /** Effective model/effort shown in the UI. */
  static effectiveModel(open: OpenThread): { model: string; effort: ReasoningEffort | null } {
    return open.override ?? { model: open.model, effort: open.effort };
  }

  async sendMessage(text: string): Promise<void> {
    const open = this.store.get().open;
    if (!open || open.state !== "ready") throw new Error("thread not ready");
    const input: v2.UserInput[] = [{ type: "text", text, text_elements: [] }];
    // Only send overrides the user actually chose: Codex treats a model
    // override as a switch (with context compaction) even when unchanged.
    const params: v2.TurnStartParams = { threadId: open.view.threadId, input };
    if (open.override) {
      params.model = open.override.model;
      params.effort = open.override.effort;
    }
    await this.rpc.request<v2.TurnStartResponse>("turn/start", params);
    if (open.override) {
      const { model, effort } = open.override;
      this.store.set((s) => (s.open && s.open.view.threadId === open.view.threadId ? { ...s, open: { ...s.open, model, effort, override: null } } : s));
    }
  }

  async startThread(cwd: string, model: string | null, effort: ReasoningEffort | null): Promise<string> {
    const res = await this.rpc.request<v2.ThreadStartResponse>("thread/start", { cwd, model });
    const threadId = res.thread.id;
    this.store.set((s) => ({
      ...s,
      open: {
        view: initialThreadState(threadId),
        state: "ready",
        error: null,
        model: res.model,
        effort: res.reasoningEffort,
        override: effort && effort !== res.reasoningEffort ? { model: res.model, effort } : null,
        cwd: res.cwd,
        olderCursor: null,
        loadingOlder: false,
      },
    }));
    this.openGeneration++;
    return threadId;
  }

  answerApproval(id: JsonRpcRequest["id"], result: unknown): void {
    this.rpc.respond(id, result);
    this.store.set((s) => (s.open ? { ...s, open: { ...s.open, view: removeApproval(s.open.view, id) } } : s));
  }

  /** Answer an `item/tool/requestUserInput`: one list of answers per question id. */
  answerUserInput(id: JsonRpcRequest["id"], answers: Record<string, string[]>): void {
    const response: v2.ToolRequestUserInputResponse = { answers: {} };
    for (const [questionId, list] of Object.entries(answers)) response.answers[questionId] = { answers: list };
    this.answerApproval(id, response);
  }

  // --- incoming -----------------------------------------------------------

  private onReconnected(): void {
    const open = this.store.get().open;
    if (open) void this.openThread(open.view.threadId, { force: true });
    void this.loadRateLimits();
  }

  private onNotification(n: JsonRpcNotification): void {
    if (n.method === "pocket/upstream/status") {
      const connected = !!(n.params as { connected?: boolean } | undefined)?.connected;
      this.store.set((s) => ({ ...s, upstreamConnected: connected }));
      return;
    }
    if (n.method === "account/rateLimits/updated") {
      const { rateLimits: snapshot } = n.params as v2.AccountRateLimitsUpdatedNotification;
      this.store.set((s) => ({ ...s, rateLimits: rateLimits(snapshot) }));
      return;
    }
    if (n.method === "warning" && (n.params as v2.WarningNotification).threadId === null) {
      const { message } = n.params as v2.WarningNotification;
      this.store.set((s) => ({ ...s, notices: [...s.notices, { id: nextNoticeId++, message }] }));
      return;
    }
    this.store.set((s) => {
      const threads = applyThreadListNotification(s.threads, n, Date.now());
      return threads === s.threads ? s : { ...s, threads };
    });
    this.store.set((s) => {
      if (!s.open) return s;
      const view = applyNotification(s.open.view, n);
      if (view === s.open.view) return s;
      // Live traffic proves the thread is ours: clear a stale resume error
      // (e.g. "no rollout" on a thread that had not been written yet).
      const state = s.open.state === "error" && n.method === "turn/started" ? "ready" : s.open.state;
      return { ...s, open: { ...s.open, view, state, error: state === "ready" ? null : s.open.error } };
    });
  }

  private onServerRequest(req: JsonRpcRequest): void {
    this.store.set((s) => {
      if (!s.open) return s;
      const view = applyServerRequest(s.open.view, req);
      return view === s.open.view ? s : { ...s, open: { ...s.open, view } };
    });
  }
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
