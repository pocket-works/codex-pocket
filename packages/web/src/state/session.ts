import type { JsonRpcNotification, JsonRpcRequest, ReasoningEffort, v2 } from "@codex-pocket/protocol";
import { RpcClient, RpcError, type ConnectionState } from "../rpc/client.js";
import { createStore, type Store } from "./store.js";
import {
  applyNotification,
  applyServerRequest,
  dismissAlert,
  initialThreadState,
  mergeTurns,
  prependHistory,
  removeApproval,
  type ThreadViewState,
} from "./thread-reducer.js";
import { applyThreadListNotification, markRead, mergeThreadList, type ThreadSummary } from "./thread-list.js";
import { summarizeProjects, type ProjectSummary } from "./projects.js";
import { buildUserInput, type Draft } from "./compose.js";
import { getLastModel, setLastModel } from "./model-prefs.js";
import {
  getFollowUpMode,
  setFollowUpMode,
  summarizeQueued,
  type FollowUpMode,
  type QueuedMessage,
  type ThreadQueueAddResponse,
  type ThreadQueueDeleteResponse,
  type ThreadQueueListResponse,
  type ThreadQueueStartResponse,
} from "./queue.js";

export type { ThreadStatus, ThreadSummary, WaitingFor } from "./thread-list.js";
export { groupByProject, isScratchThread, isWorktree, projectForCwd, summarizeProject, summarizeProjects } from "./projects.js";
export type { ProjectGroup, ProjectSummary } from "./projects.js";

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
  /** Prepaid credit balance, when the account has any; null otherwise. */
  credits: string | null;
}

export interface Notice {
  id: number;
  message: string;
}

export interface FileMatch {
  name: string;
  path: string;
  relative: string;
}

export interface Skill {
  name: string;
  description: string;
  path: string;
}

/** Approval policy + sandbox as the user sees them; both stick for later turns. */
export interface Permissions {
  approval: v2.AskForApproval;
  sandbox: v2.SandboxMode;
  /** Who reviews approval requests: the human, or Codex's auto-review subagent. */
  reviewer: v2.ApprovalsReviewer;
}

// The three presets the official app offers, mapped onto Codex policies.
export type PermissionPreset = "ask" | "auto" | "full";

export const PERMISSION_PRESETS: Record<PermissionPreset, Permissions> = {
  ask: { approval: "on-request", sandbox: "workspace-write", reviewer: "user" },
  auto: { approval: "on-request", sandbox: "workspace-write", reviewer: "auto_review" },
  full: { approval: "never", sandbox: "danger-full-access", reviewer: "user" },
};

export function permissionPreset(p: Permissions | null): PermissionPreset | null {
  if (!p) return null;
  for (const [name, preset] of Object.entries(PERMISSION_PRESETS) as [PermissionPreset, Permissions][]) {
    if (preset.approval === p.approval && preset.sandbox === p.sandbox && preset.reviewer === p.reviewer) return name;
  }
  return null;
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
  /** The app-server's follow-up queue for this thread, in order. */
  queue: QueuedMessage[];
  /** Current approval/sandbox (from resume/start); null when unknown. */
  permissions: Permissions | null;
  /** Pending user choice applied on the next turn/start. */
  permissionOverride: Permissions | null;
  /** Service tier the thread runs with (e.g. "priority" = Fast); null is standard. */
  serviceTier: string | null;
  /** Pending tier for the next turn; "default" switches back to standard, null means keep. */
  serviceTierOverride: string | null;
}

export interface SessionState {
  connection: ConnectionState;
  upstreamConnected: boolean;
  /** Projects as app-server owns them: the same list the desktop app shows. */
  projects: ProjectSummary[];
  threads: ThreadSummary[];
  threadsLoading: boolean;
  threadsError: string | null;
  models: v2.Model[];
  open: OpenThread | null;
  /** Account-wide usage, null until read. */
  rateLimits: RateLimits | null;
  /** Warnings not tied to a thread; shown app-wide until dismissed. */
  notices: Notice[];
  /** What the send button does while a turn runs (per device). */
  followUp: FollowUpMode;
}

const HISTORY_PAGE = 40;

let nextNoticeId = 1;

function rateLimitWindow(w: v2.RateLimitWindow | null): RateLimitWindow | null {
  // Codex reports resetsAt in epoch seconds; the UI works in ms.
  return w ? { usedPercent: w.usedPercent, durationMins: w.windowDurationMins, resetsAt: w.resetsAt === null ? null : w.resetsAt * 1000 } : null;
}

function rateLimits(snapshot: v2.RateLimitSnapshot): RateLimits {
  const c = snapshot.credits;
  const credits = c?.hasCredits ? (c.unlimited ? "unlimited" : c.balance) : null;
  return { primary: rateLimitWindow(snapshot.primary), secondary: rateLimitWindow(snapshot.secondary), credits };
}

function sandboxMode(policy: v2.SandboxPolicy): v2.SandboxMode {
  switch (policy.type) {
    case "dangerFullAccess":
      return "danger-full-access";
    case "workspaceWrite":
      return "workspace-write";
    default:
      return "read-only";
  }
}

function sandboxPolicy(mode: v2.SandboxMode, cwd: string): v2.SandboxPolicy {
  switch (mode) {
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    case "workspace-write":
      return { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    default:
      return { type: "readOnly", networkAccess: false };
  }
}

const DRAFT_THREAD_ID = "";

/** Branch/folder-safe name from free text, like the desktop app's `codex/<slug>`. */
export function slugify(text: string, fallback = "new-chat"): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || fallback
  );
}

export function isDraft(open: OpenThread): boolean {
  return open.view.threadId === DRAFT_THREAD_ID;
}

// A draft starts from Codex's default model, with the model the user last
// used as the pending pick (so thread/start receives it) when it still
// exists and differs from the default.
function withDefaultModel(open: OpenThread, models: v2.Model[]): OpenThread {
  const def = models.find((m) => m.isDefault) ?? models[0];
  if (!def) return open;
  const last = getLastModel();
  const remembered = last && models.some((m) => m.model === last.model) ? last : null;
  const override = remembered && (remembered.model !== def.model || remembered.effort !== def.defaultReasoningEffort) ? remembered : null;
  return { ...open, model: def.model, effort: def.defaultReasoningEffort, override };
}

function isLockedError(err: unknown): boolean {
  return err instanceof RpcError && /active writer/i.test(err.message);
}

// Everything the UI can do, on top of one RpcClient. State is in `store`.
export class Session {
  readonly store: Store<SessionState>;
  /** Host-level features (dictation) speak to the socket directly. */
  readonly rpc: RpcClient;
  private openGeneration = 0;

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
    this.store = createStore<SessionState>({
      connection: rpc.connectionState,
      upstreamConnected: false,
      projects: [],
      threads: [],
      threadsLoading: false,
      threadsError: null,
      models: [],
      open: null,
      rateLimits: null,
      notices: [],
      followUp: getFollowUpMode(),
    });
    rpc.onStateChange((connection) => {
      this.store.set((s) => ({ ...s, connection, upstreamConnected: connection === "open" ? s.upstreamConnected : false }));
      if (connection === "open") this.onReconnected();
    });
    rpc.onNotification((n) => this.handleNotification(n));
    rpc.onServerRequest((req) => this.onServerRequest(req));
    // The host mutes push notifications for the thread on screen.
    let lastThread: string | null = null;
    this.store.subscribe(() => {
      const threadId = this.store.get().open?.view.threadId || null;
      if (threadId === lastThread) return;
      lastThread = threadId;
      this.reportClientState();
    });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => this.reportClientState());
  }

  private reportClientState(): void {
    if (this.store.get().connection !== "open") return;
    const threadId = this.store.get().open?.view.threadId || null;
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    this.rpc.notify("pocket/client/state", { threadId, visible });
  }

  start(): void {
    this.rpc.start();
  }

  // --- projects -----------------------------------------------------------

  /**
   * The desktop's project list, straight from app-server. Threads carry a
   * `projectId` and projects carry their roots, so the phone groups by what
   * the desktop actually created instead of guessing from folder names.
   */
  async loadProjects(): Promise<void> {
    try {
      // The server pages this list (25 by default), and the phone wants them
      // all: an empty project still has to show up so it can be opened.
      const all: v2.Project[] = [];
      let cursor: string | null = null;
      for (;;) {
        const res: v2.ProjectListResponse = await this.rpc.request<v2.ProjectListResponse>("project/list", { sortKey: "position", limit: 200, cursor });
        all.push(...res.data);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      this.store.set((s) => ({ ...s, projects: summarizeProjects(all) }));
    } catch {
      // Older app-server without the project API, or a transient failure: keep
      // whatever list we already had. Threads without a project simply show up
      // as chats, which beats inventing projects from folder names again.
    }
  }

  // --- thread list --------------------------------------------------------

  async loadThreads(): Promise<void> {
    this.store.set((s) => ({ ...s, threadsLoading: true, threadsError: null }));
    try {
      const res = await this.rpc.request<v2.ThreadListResponse>("thread/list", { limit: 60, sortKey: "recency_at" });
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

  /** Nudges list subscribers after a per-device change such as a pin. */
  touchThreads(): void {
    this.store.set((s) => ({ ...s, threads: s.threads.slice() }));
  }

  /** App-wide warning banner, e.g. when a list action fails. */
  notify(message: string): void {
    this.store.set((s) => ({ ...s, notices: [...s.notices, { id: nextNoticeId++, message }] }));
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
    this.store.set((s) => {
      const models = res.data.filter((m) => !m.hidden);
      const open = s.open && isDraft(s.open) && !s.open.model ? withDefaultModel(s.open, models) : s.open;
      return { ...s, models, open };
    });
  }

  // --- draft thread (new-thread screen) ----------------------------------

  /**
   * A placeholder `open` for the new-thread screen so the composer toolbar
   * (model, permissions) works before the thread exists; the picks are read
   * back by `startThread` callers. Nothing is sent to Codex.
   */
  openDraft(cwd: string): void {
    this.openGeneration++;
    this.store.set((s) => ({
      ...s,
      open: withDefaultModel(
        {
          view: initialThreadState(DRAFT_THREAD_ID),
          state: "loading",
          error: null,
          model: "",
          effort: null,
          override: null,
          cwd,
          olderCursor: null,
          loadingOlder: false,
          queue: [],
          // Codex's own default; thread/start reports the real one.
          permissions: PERMISSION_PRESETS.ask,
          permissionOverride: null,
          serviceTier: null,
          serviceTierOverride: null,
        },
        s.models,
      ),
    }));
  }

  setDraftCwd(cwd: string): void {
    this.store.set((s) => (s.open && isDraft(s.open) && s.open.cwd !== cwd ? { ...s, open: { ...s.open, cwd } } : s));
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
        override: current?.view.threadId === threadId ? current.override : null,
        cwd: current?.cwd ?? "",
        olderCursor: null,
        loadingOlder: false,
        queue: current?.view.threadId === threadId ? current.queue : [],
        permissions: current?.view.threadId === threadId ? current.permissions : null,
        permissionOverride: current?.view.threadId === threadId ? current.permissionOverride : null,
        serviceTier: current?.view.threadId === threadId ? current.serviceTier : null,
        serviceTierOverride: current?.view.threadId === threadId ? current.serviceTierOverride : null,
      },
    }));
    try {
      const resumed = await this.rpc.request<v2.ThreadResumeResponse>("thread/resume", { threadId, excludeTurns: true });
      if (generation !== this.openGeneration) return;
      const history = await this.loadHistory(threadId);
      if (generation !== this.openGeneration) return;
      this.store.set((s) => {
        if (!s.open || s.open.view.threadId !== threadId) return s;
        // History replaces what we had: after a reconnect it is the truth.
        const fresh = mergeTurns(prependHistory(initialThreadState(threadId), history.entries), history.turns);
        const view: ThreadViewState = { ...fresh, approvals: s.open.view.approvals };
        return {
          ...s,
          threads: markRead(s.threads, threadId),
          open: {
            ...s.open,
            view,
            state: "ready",
            model: resumed.model,
            effort: resumed.reasoningEffort,
            cwd: resumed.cwd,
            olderCursor: history.olderCursor,
            permissions: { approval: resumed.approvalPolicy, sandbox: sandboxMode(resumed.sandbox), reviewer: resumed.approvalsReviewer },
            serviceTier: resumed.serviceTier,
          },
        };
      });
      void this.loadQueue(threadId);
    } catch (err) {
      if (generation !== this.openGeneration) return;
      this.store.set((s) =>
        s.open && s.open.view.threadId === threadId
          ? { ...s, open: { ...s.open, state: isLockedError(err) ? "locked" : "error", error: describe(err) } }
          : s,
      );
    }
  }

  // Newest page of history, oldest first. Until a thread's first turn has
  // been persisted Codex rejects the paginated endpoints ("not supported
  // yet"), so fall back to a full read, and failing that start empty: live
  // notifications fill the view in either case.
  private async loadHistory(threadId: string): Promise<{ entries: v2.ThreadItemEntry[]; turns: v2.Turn[]; olderCursor: string | null }> {
    try {
      const [page, turns] = await Promise.all([
        this.rpc.request<v2.ThreadItemsListResponse>("thread/items/list", { threadId, limit: HISTORY_PAGE, sortDirection: "desc" }),
        this.loadTurnMeta(threadId),
      ]);
      return { entries: page.data.slice().reverse(), turns, olderCursor: page.nextCursor };
    } catch (err) {
      if (!/not supported/i.test(describe(err))) throw err;
    }
    try {
      const { thread } = await this.rpc.request<v2.ThreadReadResponse>("thread/read", { threadId, includeTurns: true });
      const entries = thread.turns.flatMap((t) => t.items.map((item) => ({ turnId: t.id, item })));
      return { entries, turns: thread.turns, olderCursor: null };
    } catch {
      return { entries: [], turns: [], olderCursor: null };
    }
  }

  // Timing/status per turn ("Worked for 36s"). Items pages carry only ids,
  // so fetch turns without items and keep paging until the wanted ids show up.
  private async loadTurnMeta(threadId: string, wanted?: string[]): Promise<v2.Turn[]> {
    const need = new Set(wanted ?? []);
    const out: v2.Turn[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res: v2.ThreadTurnsListResponse = await this.rpc.request<v2.ThreadTurnsListResponse>("thread/turns/list", {
        threadId,
        cursor,
        limit: 50,
        sortDirection: "desc",
        itemsView: "notLoaded",
      });
      out.push(...res.data);
      for (const t of res.data) need.delete(t.id);
      cursor = res.nextCursor;
      if (!cursor || (wanted ? need.size === 0 : true)) break;
    }
    return out;
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
      const turns = await this.loadTurnMeta(threadId, page.data.map((e) => e.turnId));
      this.store.set((s) =>
        s.open && s.open.view.threadId === threadId
          ? { ...s, open: { ...s.open, view: mergeTurns(prependHistory(s.open.view, page.data.slice().reverse()), turns), olderCursor: page.nextCursor, loadingOlder: false } }
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
    if (threadId === DRAFT_THREAD_ID) return;
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

  /** Whether the next turn runs on a faster-than-standard tier. */
  static isFast(open: OpenThread): boolean {
    const tier = open.serviceTierOverride ?? open.serviceTier;
    return tier !== null && tier !== "default";
  }

  /** `null` means standard speed; Codex spells that "default" on the wire. */
  setServiceTier(tier: string | null): void {
    this.store.set((s) => {
      if (!s.open) return s;
      const same = (tier ?? null) === s.open.serviceTier;
      return { ...s, open: { ...s.open, serviceTierOverride: same ? null : (tier ?? "default") } };
    });
  }

  async sendMessage(draft: Draft): Promise<void> {
    const open = this.store.get().open;
    if (!open || open.state !== "ready") throw new Error("thread not ready");
    const threadId = open.view.threadId;
    const input = buildUserInput(draft);
    if (input.length === 0) return;

    // While a turn runs, either steer it (Codex folds the input into the
    // current turn) or queue it for the next one, per the user's preference.
    // Review/compact turns cannot be steered, so steering falls back to the
    // queue.
    const activeTurnId = open.view.activeTurnId;
    if (activeTurnId) {
      if (this.store.get().followUp === "steer") {
        try {
          await this.rpc.request<v2.TurnSteerResponse>("turn/steer", { threadId, input, expectedTurnId: activeTurnId });
          return;
        } catch (err) {
          if (!(err instanceof RpcError)) throw err;
        }
      }
      await this.enqueue(threadId, input);
      return;
    }

    // Only send overrides the user actually chose: Codex treats a model
    // override as a switch (with context compaction) even when unchanged.
    const params: v2.TurnStartParams = { threadId, input };
    if (open.override) {
      params.model = open.override.model;
      params.effort = open.override.effort;
    }
    const perms = open.permissionOverride;
    if (perms) {
      params.approvalPolicy = perms.approval;
      params.sandboxPolicy = sandboxPolicy(perms.sandbox, open.cwd);
      params.approvalsReviewer = perms.reviewer;
    }
    const tier = open.serviceTierOverride;
    if (tier) params.serviceTier = tier;
    await this.rpc.request<v2.TurnStartResponse>("turn/start", params);
    this.store.set((s) => {
      if (!s.open || s.open.view.threadId !== threadId) return s;
      const next = { ...s.open };
      if (open.override) Object.assign(next, { model: open.override.model, effort: open.override.effort, override: null });
      if (perms) Object.assign(next, { permissions: perms, permissionOverride: null });
      if (tier) Object.assign(next, { serviceTier: tier === "default" ? null : tier, serviceTierOverride: null });
      return { ...s, open: next };
    });
    if (open.override) setLastModel(open.override);
  }

  /** Sends the last user message again after a turn failed (network, model errors). */
  async retryLastTurn(): Promise<void> {
    const open = this.store.get().open;
    if (!open || open.state !== "ready" || !open.view.lastTurnError || open.view.activeTurnId) return;
    const last = [...open.view.items].reverse().find((i) => i.type === "userMessage");
    if (!last || last.type !== "userMessage" || last.content.length === 0) return;
    const threadId = open.view.threadId;
    await this.rpc.request<v2.TurnStartResponse>("turn/start", { threadId, input: last.content });
    this.store.set((s) => (s.open && s.open.view.threadId === threadId ? { ...s, open: { ...s.open, view: { ...s.open.view, lastTurnError: null } } } : s));
  }

  // --- follow-up queue (thread/queue/*) -----------------------------------

  setFollowUpMode(mode: FollowUpMode): void {
    setFollowUpMode(mode);
    this.store.set((s) => ({ ...s, followUp: mode }));
  }

  private setQueue(threadId: string, update: (queue: QueuedMessage[]) => QueuedMessage[]): void {
    this.store.set((s) => (s.open && s.open.view.threadId === threadId ? { ...s, open: { ...s.open, queue: update(s.open.queue) } } : s));
  }

  private async enqueue(threadId: string, input: v2.UserInput[]): Promise<void> {
    const res = await this.rpc.request<ThreadQueueAddResponse>("thread/queue/add", {
      threadId,
      input,
      clientUserMessageId: `pocket-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    const item = summarizeQueued(res.queuedSubmission);
    this.setQueue(threadId, (queue) => (queue.some((q) => q.id === item.id) ? queue : [...queue, item]));
  }

  /** Full queue from the server; also the answer to `thread/queue/changed`. */
  private async loadQueue(threadId: string): Promise<void> {
    const items: QueuedMessage[] = [];
    let cursor: string | null = null;
    try {
      do {
        const page: ThreadQueueListResponse = await this.rpc.request<ThreadQueueListResponse>("thread/queue/list", { threadId, cursor });
        items.push(...page.data.map(summarizeQueued));
        cursor = page.nextCursor;
      } while (cursor);
    } catch {
      // Older Codex without the queue API: the list just stays empty.
      return;
    }
    this.setQueue(threadId, () => items);
  }

  async deleteQueued(id: string): Promise<void> {
    const open = this.store.get().open;
    if (!open) return;
    const threadId = open.view.threadId;
    await this.rpc.request<ThreadQueueDeleteResponse>("thread/queue/delete", { threadId, queuedSubmissionId: id });
    this.setQueue(threadId, (queue) => queue.filter((q) => q.id !== id));
  }

  /**
   * Sends a queued message without waiting: steered into the running turn
   * (and taken off the queue), or started as a turn when the thread is idle.
   */
  async sendQueuedNow(id: string): Promise<void> {
    const open = this.store.get().open;
    const item = open?.queue.find((q) => q.id === id);
    if (!open || !item) return;
    const threadId = open.view.threadId;
    const activeTurnId = open.view.activeTurnId;
    if (activeTurnId) {
      await this.rpc.request<v2.TurnSteerResponse>("turn/steer", { threadId, input: item.input, expectedTurnId: activeTurnId });
      await this.rpc.request<ThreadQueueDeleteResponse>("thread/queue/delete", { threadId, queuedSubmissionId: id });
    } else {
      await this.rpc.request<ThreadQueueStartResponse>("thread/queue/start", { threadId, queuedSubmissionId: id });
    }
    this.setQueue(threadId, (queue) => queue.filter((q) => q.id !== id));
  }

  /**
   * Codex only drains the queue after a turn that completed; after an
   * interrupt the queue waits for this.
   */
  async resumeQueue(): Promise<void> {
    const open = this.store.get().open;
    const first = open?.queue[0];
    if (!open || !first || open.view.activeTurnId) return;
    await this.sendQueuedNow(first.id);
  }

  private searchToken = 0;

  /** Fuzzy file search under the open thread's cwd; stale results resolve to []. */
  async searchFiles(query: string): Promise<FileMatch[]> {
    const open = this.store.get().open;
    if (!open || !open.cwd || !query) return [];
    const token = ++this.searchToken;
    const res = await this.rpc.request<{ files: { root: string; path: string; file_name: string }[] }>("fuzzyFileSearch", {
      query,
      roots: [open.cwd],
      cancellationToken: String(token),
    });
    if (token !== this.searchToken) return [];
    return res.files.map((f) => ({ name: f.file_name, path: `${f.root.replace(/\/$/, "")}/${f.path}`, relative: f.path }));
  }

  private skillsCache = new Map<string, Skill[]>();

  async loadSkills(): Promise<Skill[]> {
    const open = this.store.get().open;
    if (!open || !open.cwd) return [];
    const cached = this.skillsCache.get(open.cwd);
    if (cached) return cached;
    const res = await this.rpc.request<v2.SkillsListResponse>("skills/list", { cwds: [open.cwd] });
    const skills = res.data
      .flatMap((entry) => entry.skills)
      .filter((sk) => sk.enabled)
      .map((sk) => ({ name: sk.name, description: sk.shortDescription ?? sk.description, path: sk.path }));
    this.skillsCache.set(open.cwd, skills);
    return skills;
  }

  async startThread(
    cwd: string,
    model: string | null,
    effort: ReasoningEffort | null,
    serviceTier: string | null = null,
    /** Project the new thread belongs to; omit for a project-less chat. */
    projectId: string | null = null,
  ): Promise<string> {
    const res = await this.rpc.request<v2.ThreadStartResponse>("thread/start", { cwd, model, serviceTier, projectId });
    this.adoptStarted(res, effort);
    setLastModel({ model: res.model, effort: effort ?? res.reasoningEffort });
    return res.thread.id;
  }

  // A thread we just started/forked is live already; resuming it would fail
  // because Codex has not written its rollout yet, so open it directly.
  private adoptStarted(res: v2.ThreadStartResponse | v2.ThreadForkResponse, effort: ReasoningEffort | null = null): void {
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
        queue: [],
        permissions: { approval: res.approvalPolicy, sandbox: sandboxMode(res.sandbox), reviewer: res.approvalsReviewer },
        permissionOverride: null,
        serviceTier: res.serviceTier,
        serviceTierOverride: null,
      },
    }));
    this.openGeneration++;
  }

  // --- thread management --------------------------------------------------

  async renameThread(threadId: string, name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    await this.rpc.request("thread/name/set", { threadId, name: clean });
    // The desktop hears thread/name/updated; we may not, so update locally.
    this.store.set((s) => ({ ...s, threads: s.threads.map((t) => (t.id === threadId ? { ...t, title: clean } : t)) }));
  }

  /** Archived threads, newest first (not kept in the store: rarely viewed). */
  async loadArchivedThreads(): Promise<ThreadSummary[]> {
    const res = await this.rpc.request<v2.ThreadListResponse>("thread/list", { limit: 100, sortKey: "recency_at", archived: true });
    return mergeThreadList([], res.data);
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.rpc.request("thread/unarchive", { threadId });
    await this.loadThreads();
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.rpc.request("thread/archive", { threadId });
    this.store.set((s) => ({ ...s, threads: s.threads.filter((t) => t.id !== threadId) }));
    if (this.store.get().open?.view.threadId === threadId) await this.closeThread();
  }

  /** Copies the thread's history into a new one and opens it. */
  async forkThread(threadId: string): Promise<string> {
    const res = await this.rpc.request<v2.ThreadForkResponse>("thread/fork", { threadId });
    this.adoptStarted(res);
    return res.thread.id;
  }

  /** Asks Codex to review the working tree; the review runs as a turn on this thread. */
  async startReview(): Promise<void> {
    const open = this.store.get().open;
    if (!open || open.state !== "ready") throw new Error("thread not ready");
    const params: v2.ReviewStartParams = { threadId: open.view.threadId, target: { type: "uncommittedChanges" }, delivery: "inline" };
    await this.rpc.request<v2.ReviewStartResponse>("review/start", params);
  }

  /**
   * Summarises the thread's context so a long thread keeps room to work.
   * Codex runs it as a turn, so it cannot overlap a running one.
   */
  async compactThread(): Promise<void> {
    const open = this.store.get().open;
    if (!open || open.state !== "ready") throw new Error("thread not ready");
    if (open.view.activeTurnId) throw new Error("Compact is disabled while a turn is in progress");
    const params: v2.ThreadCompactStartParams = { threadId: open.view.threadId };
    await this.rpc.request<v2.ThreadCompactStartResponse>("thread/compact/start", params);
  }

  setPermissions(approval: v2.AskForApproval, sandbox: v2.SandboxMode, reviewer?: v2.ApprovalsReviewer): void {
    this.store.set((s) => {
      if (!s.open) return s;
      const current = s.open.permissions;
      const next: Permissions = { approval, sandbox, reviewer: reviewer ?? current?.reviewer ?? "user" };
      const same = current && current.approval === next.approval && current.sandbox === next.sandbox && current.reviewer === next.reviewer;
      return { ...s, open: { ...s.open, permissionOverride: same ? null : next } };
    });
  }

  setPermissionPreset(preset: PermissionPreset): void {
    const p = PERMISSION_PRESETS[preset];
    this.setPermissions(p.approval, p.sandbox, p.reviewer);
  }

  // --- git (command/exec on the Mac) ---------------------------------------

  private async exec(cwd: string, command: string[], writableRoots: string[] = []): Promise<v2.CommandExecResponse> {
    const params: v2.CommandExecParams = { command, cwd, timeoutMs: 15_000 };
    if (writableRoots.length > 0) params.sandboxPolicy = { type: "workspaceWrite", writableRoots, networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    return this.rpc.request<v2.CommandExecResponse>("command/exec", params);
  }

  private async git(cwd: string, args: string[], writableRoots: string[] = []): Promise<string> {
    const res = await this.exec(cwd, ["git", ...args], writableRoots);
    if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `git ${args[0]} failed (${res.exitCode})`);
    return res.stdout;
  }

  /** Current branch and local branches of `cwd`; null when it is not a git checkout. */
  async gitInfo(cwd: string): Promise<{ branch: string; branches: string[] } | null> {
    try {
      const branch = (await this.git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const branches = (await this.git(cwd, ["branch", "--format=%(refname:short)"])).split("\n").map((b) => b.trim()).filter(Boolean);
      return { branch, branches };
    } catch {
      return null;
    }
  }

  /**
   * Working-tree changes as a unified diff, like the official Changes tab:
   * "uncommitted" is everything since HEAD (untracked files included),
   * "branch" is everything since the branch left its upstream.
   */
  async gitChanges(cwd: string, mode: "uncommitted" | "branch"): Promise<{ diff: string; branch: string; upstream: string | null }> {
    const branch = (await this.git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    let upstream: string | null = null;
    try {
      upstream = (await this.git(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"])).trim();
    } catch {
      // No upstream configured: branch mode falls back to uncommitted.
    }
    let base = "HEAD";
    if (mode === "branch" && upstream) base = (await this.git(cwd, ["merge-base", "HEAD", upstream])).trim();
    let diff = await this.git(cwd, ["diff", base, "--"]);
    // `git diff` skips untracked files; show them as additions (exit 1 = has differences).
    const untracked = (await this.git(cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean).slice(0, 50);
    for (const file of untracked) {
      const res = await this.exec(cwd, ["git", "diff", "--no-index", "--", "/dev/null", file]);
      if (res.exitCode === 0 || res.exitCode === 1) diff += res.stdout.replace(/^diff --git a\/dev\/null b\/(.*)$/m, "diff --git a/$1 b/$1");
    }
    return { diff, branch, upstream };
  }

  async gitSwitch(cwd: string, branch: string): Promise<void> {
    await this.git(cwd, ["switch", branch], [cwd, ...(await this.gitDirs(cwd))]);
  }

  /**
   * The checkout's git dirs (shared one first, then the worktree's own when
   * they differ). Codex's workspace-write sandbox keeps `.git` under a
   * writable root read-only, so commands that touch refs, HEAD or the index
   * must list these as roots of their own.
   */
  private async gitDirs(cwd: string): Promise<string[]> {
    const out = await this.git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"]);
    return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))];
  }

  /**
   * New worktree at ~/.codex/worktrees/<id>/<repo> on a fresh `codex/<slug>`
   * branch off `base`, mirroring the desktop app; returns its path.
   */
  async gitWorktreeAdd(cwd: string, home: string, base: string, text: string): Promise<string> {
    const repo = cwd.split("/").filter(Boolean).pop() ?? "repo";
    const id = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
    const root = `${home.replace(/\/$/, "")}/.codex/worktrees`;
    const path = `${root}/${id}/${repo}`;
    await this.git(cwd, ["worktree", "add", "-b", `codex/${slugify(text)}`, path, base], [cwd, root, ...(await this.gitDirs(cwd))]);
    return path;
  }

  async createDirectory(path: string): Promise<void> {
    await this.rpc.request("fs/createDirectory", { path, recursive: true });
  }

  /** Files and folders under `path`, folders first, for the Files browser. Dotfiles hidden. */
  async listEntries(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const res = await this.rpc.request<v2.FsReadDirectoryResponse>("fs/readDirectory", { path });
    return res.entries
      .filter((e) => (e.isDirectory || e.isFile) && !e.fileName.startsWith("."))
      .map((e) => ({ name: e.fileName, isDirectory: e.isDirectory }))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  }

  /** A text file's contents; null when it does not look like text. */
  async readTextFile(path: string): Promise<string | null> {
    const res = await this.rpc.request<v2.FsReadFileResponse>("fs/readFile", { path });
    const bytes = Uint8Array.from(atob(res.dataBase64), (c) => c.charCodeAt(0));
    const probe = bytes.subarray(0, 4096);
    if (probe.includes(0)) return null;
    return new TextDecoder().decode(bytes);
  }

  /** Child directories of `path`, for picking a project folder. Dotfiles hidden. */
  async listDirectory(path: string): Promise<string[]> {
    const res = await this.rpc.request<v2.FsReadDirectoryResponse>("fs/readDirectory", { path });
    return res.entries
      .filter((e) => e.isDirectory && !e.fileName.startsWith("."))
      .map((e) => e.fileName)
      .sort((a, b) => a.localeCompare(b));
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
    void this.loadProjects();
    void this.loadRateLimits();
    this.reportClientState();
  }

  /** Public so tests can feed notifications without a socket. */
  handleNotification(n: JsonRpcNotification): void {
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
      this.notify(message);
      return;
    }
    // In shared mode the desktop app may change the thread's model or
    // permissions; mirror them so the toolbar and the next turn agree.
    if (n.method === "thread/settings/updated") {
      const { threadId, threadSettings: t } = n.params as v2.ThreadSettingsUpdatedNotification;
      this.store.set((s) =>
        s.open && s.open.view.threadId === threadId
          ? {
              ...s,
              open: {
                ...s.open,
                model: t.model,
                effort: t.effort,
                serviceTier: t.serviceTier,
                permissions: { approval: t.approvalPolicy, sandbox: sandboxMode(t.sandboxPolicy), reviewer: t.approvalsReviewer },
              },
            }
          : s,
      );
      return;
    }
    if (n.method === "thread/queue/changed") {
      const { threadId } = n.params as v2.ThreadQueueChangedNotification;
      if (this.store.get().open?.view.threadId === threadId) void this.loadQueue(threadId);
      return;
    }
    if (n.method === "project/changed") {
      // The desktop created, renamed, moved, or deleted a project. Re-reading
      // is cheap and keeps the phone honest, including for deletions.
      void this.loadProjects();
      return;
    }
    this.store.set((s) => {
      let threads = applyThreadListNotification(s.threads, n, Date.now());
      // A turn that finishes while its thread is on screen is already read.
      const onScreen = s.open?.view.threadId;
      if (n.method === "turn/completed" && onScreen !== undefined && (n.params as { threadId?: string }).threadId === onScreen) {
        threads = markRead(threads, onScreen);
      }
      return threads === s.threads ? s : { ...s, threads };
    });
    this.store.set((s) => {
      if (!s.open) return s;
      const view = applyNotification(s.open.view, n);
      if (view === s.open.view) return s;
      // Live traffic proves the thread is ours: clear a stale resume error
      // (e.g. "no rollout" on a thread that had not been written yet).
      const started = n.method === "turn/started";
      const state = s.open.state === "error" && started ? "ready" : s.open.state;
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
