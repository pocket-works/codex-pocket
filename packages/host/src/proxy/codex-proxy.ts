import type { JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, RequestId } from "@codex-pocket/protocol";
import type { CodexClient } from "../codex/codex-client.js";
import { ServerRequestAbandoned } from "../codex/jsonrpc-connection.js";

// Methods the host owns; a phone must never send them upstream.
const BLOCKED_METHODS = new Set(["initialize", "initialized"]);

// Host-originated notifications, namespaced so they can never collide with
// Codex methods.
export const POCKET_UPSTREAM_STATUS = "pocket/upstream/status";

export interface Downstream {
  send(msg: JsonRpcMessage): void;
}

export interface DownstreamHandle {
  receive(msg: JsonRpcMessage): void;
  detach(): void;
}

interface PendingServerRequest {
  request: JsonRpcRequest;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface CodexProxyOptions {
  connect: () => Promise<CodexClient>;
  /** Backoff schedule for upstream reconnects, in ms. Last value repeats. */
  backoffMs?: number[];
  /** How long to keep thread subscriptions after the last phone leaves. */
  releaseGraceMs?: number;
  /** Sees every upstream notification and server request (e.g. for push notifications). */
  tap?: (msg: JsonRpcMessage) => void;
  log?: (msg: string) => void;
}

// Fans one Codex app-server connection out to many phones.
//
// - Phone requests go upstream and their responses come back to that phone.
// - Upstream notifications are broadcast to every phone.
// - Upstream server requests (approvals etc.) are broadcast; the first phone
//   to answer wins. Unanswered ones are replayed to phones that connect later,
//   and dropped when Codex reports them resolved elsewhere (e.g. the desktop
//   app answered).
// - Codex allows one writer per thread. Threads this connection has resumed
//   are released (`thread/unsubscribe`) shortly after the last phone leaves,
//   so the desktop app can pick them up again.
export class CodexProxy {
  private readonly opts: Required<Pick<CodexProxyOptions, "backoffMs" | "log" | "releaseGraceMs">> & CodexProxyOptions;
  private readonly heldThreads = new Set<string>();
  private releaseTimer: NodeJS.Timeout | null = null;
  private readonly downstreams = new Set<Downstream>();
  private readonly pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  private upstream: CodexClient | null = null;
  private connecting: Promise<CodexClient> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(opts: CodexProxyOptions) {
    this.opts = { backoffMs: [500, 1000, 2000, 5000, 10000], releaseGraceMs: 5000, log: () => {}, ...opts };
  }

  get isUpstreamConnected(): boolean {
    return this.upstream !== null;
  }

  get pendingServerRequestCount(): number {
    return this.pendingServerRequests.size;
  }

  get heldThreadIds(): string[] {
    return [...this.heldThreads];
  }

  // Establish the upstream connection now (otherwise it happens lazily on
  // the first phone request).
  async start(): Promise<void> {
    await this.ensureUpstream();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.upstream?.close();
  }

  attach(down: Downstream): DownstreamHandle {
    this.downstreams.add(down);
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    down.send(this.statusNotification());
    for (const p of this.pendingServerRequests.values()) down.send(p.request);
    return {
      receive: (msg) => this.handleDownstreamMessage(down, msg),
      detach: () => {
        this.downstreams.delete(down);
        if (this.downstreams.size === 0) this.scheduleRelease();
      },
    };
  }

  /** A request the host itself makes upstream (read-only lookups). */
  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.ensureUpstream().then((up) => up.rawRequest<T>(method, params));
  }

  private handleDownstreamMessage(down: Downstream, msg: JsonRpcMessage): void {
    if ("method" in msg) {
      if ("id" in msg) void this.forwardRequest(down, msg as JsonRpcRequest);
      else this.forwardNotification(msg as JsonRpcNotification);
      return;
    }
    if ("id" in msg) this.answerServerRequest(msg as JsonRpcResponse);
  }

  private async forwardRequest(down: Downstream, req: JsonRpcRequest): Promise<void> {
    if (BLOCKED_METHODS.has(req.method)) {
      down.send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `${req.method} is handled by the host` } });
      return;
    }
    try {
      const upstream = await this.ensureUpstream();
      const result = await upstream.rawRequest(req.method, req.params);
      this.trackThreadOwnership(req, result);
      down.send({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      const e = err as { code?: number; message?: string; data?: unknown };
      down.send({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: typeof e.code === "number" ? e.code : -32000, message: e.message ?? String(err), data: e.data },
      });
    }
  }

  private trackThreadOwnership(req: JsonRpcRequest, result: unknown): void {
    const params = req.params as { threadId?: unknown } | undefined;
    if (req.method === "thread/resume" && typeof params?.threadId === "string") {
      this.heldThreads.add(params.threadId);
    } else if (req.method === "thread/start") {
      const id = (result as { thread?: { id?: unknown } } | undefined)?.thread?.id;
      if (typeof id === "string") this.heldThreads.add(id);
    } else if (req.method === "thread/unsubscribe" && typeof params?.threadId === "string") {
      this.heldThreads.delete(params.threadId);
    }
  }

  private scheduleRelease(): void {
    if (this.releaseTimer || this.heldThreads.size === 0) return;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      if (this.downstreams.size > 0) return;
      void this.releaseHeldThreads();
    }, this.opts.releaseGraceMs);
  }

  private async releaseHeldThreads(): Promise<void> {
    const upstream = this.upstream;
    if (!upstream) {
      this.heldThreads.clear();
      return;
    }
    for (const threadId of [...this.heldThreads]) {
      this.heldThreads.delete(threadId);
      try {
        await upstream.rawRequest("thread/unsubscribe", { threadId });
        this.opts.log(`released thread ${threadId}`);
      } catch (err) {
        this.opts.log(`failed to release thread ${threadId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private forwardNotification(n: JsonRpcNotification): void {
    if (BLOCKED_METHODS.has(n.method)) return;
    this.upstream?.conn.notify(n.method, n.params);
  }

  private answerServerRequest(res: JsonRpcResponse): void {
    const pending = this.pendingServerRequests.get(res.id);
    if (!pending) return;
    this.pendingServerRequests.delete(res.id);
    if (res.error) pending.reject(Object.assign(new Error(res.error.message), { code: res.error.code }));
    else pending.resolve(res.result);
  }

  private broadcast(msg: JsonRpcMessage): void {
    for (const d of this.downstreams) d.send(msg);
  }

  private statusNotification(): JsonRpcNotification {
    return {
      jsonrpc: "2.0",
      method: POCKET_UPSTREAM_STATUS,
      params: { connected: this.upstream !== null, serverInfo: this.upstream?.serverInfo ?? null },
    };
  }

  private ensureUpstream(): Promise<CodexClient> {
    if (this.upstream) return Promise.resolve(this.upstream);
    if (this.connecting) return this.connecting;
    if (this.stopped) return Promise.reject(new Error("proxy stopped"));
    this.connecting = this.opts.connect().then(
      (client) => {
        this.connecting = null;
        this.attempt = 0;
        this.adoptUpstream(client);
        return client;
      },
      (err) => {
        this.connecting = null;
        this.scheduleReconnect();
        throw err;
      },
    );
    return this.connecting;
  }

  private adoptUpstream(client: CodexClient): void {
    this.upstream = client;
    client.onNotification((n) => {
      if (n.method === "serverRequest/resolved") {
        const requestId = (n.params as { requestId?: RequestId } | undefined)?.requestId;
        if (requestId !== undefined) this.abandonServerRequest(requestId);
      }
      this.broadcast(n);
      this.opts.tap?.(n);
    });
    client.onServerRequest((req) => {
      return new Promise((resolve, reject) => {
        this.pendingServerRequests.set(req.id, { request: req, resolve, reject });
        this.broadcast(req);
        this.opts.tap?.(req);
      });
    });
    client.onClose((reason) => {
      this.opts.log(`upstream closed: ${reason}`);
      if (this.upstream !== client) return;
      this.upstream = null;
      this.heldThreads.clear();
      for (const id of [...this.pendingServerRequests.keys()]) this.abandonServerRequest(id);
      this.broadcast(this.statusNotification());
      this.scheduleReconnect();
    });
    this.broadcast(this.statusNotification());
  }

  private abandonServerRequest(id: RequestId): void {
    const pending = this.pendingServerRequests.get(id);
    if (!pending) return;
    this.pendingServerRequests.delete(id);
    pending.reject(new ServerRequestAbandoned());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const schedule = this.opts.backoffMs;
    const delay = schedule[Math.min(this.attempt, schedule.length - 1)];
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureUpstream().catch(() => {});
    }, delay);
  }
}
