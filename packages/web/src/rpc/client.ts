import type { JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, RequestId } from "@codex-pocket/protocol";

export type ConnectionState = "connecting" | "open" | "closed";
export type NotificationListener = (n: JsonRpcNotification) => void;
export type ServerRequestListener = (req: JsonRpcRequest) => void;

/** Error code for requests that failed because the socket was not open. */
export const CONNECTION_ERROR = -32001;

/** True when the connection was unavailable or a request was not confirmed. */
export function isConnectionError(err: unknown): err is RpcError {
  return err instanceof RpcError && err.code === CONNECTION_ERROR;
}

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RpcClientOptions {
  url: string;
  token: string;
  /** Reconnect delays in ms; the last one repeats. Short on purpose: LAN. */
  backoffMs?: number[];
}

// Browser-side JSON-RPC over the host's /ws. Reconnects aggressively, since
// the whole point of the project is that a phone waking up is back in under
// a second on the LAN. Server-initiated requests (approvals) are surfaced to
// a listener and answered via `respond`.
export class RpcClient {
  private readonly opts: Required<RpcClientOptions>;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<RequestId, Pending>();
  private readonly notificationListeners = new Set<NotificationListener>();
  private readonly serverRequestListeners = new Set<ServerRequestListener>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private state: ConnectionState = "closed";
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private stopped = false;
  private revoked = false;

  get pairingRevoked(): boolean { return this.revoked; }

  constructor(opts: RpcClientOptions) {
    this.opts = { backoffMs: [250, 500, 1000, 2000, 3000], ...opts };
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  start(): void {
    if (!this.stopped && this.state !== "closed") return;
    this.stopped = false;
    this.revoked = false;
    this.connect();
    window.addEventListener("online", this.kick);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("online", this.kick);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
    }
    this.rejectAllPending("connection stopped; request outcome may be unknown");
    this.setState("closed");
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new RpcError(CONNECTION_ERROR, "not connected"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(CONNECTION_ERROR, "request timed out; check the thread before sending again"));
      }, 30_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /** Answer a server-initiated request (approval etc.). */
  respond(id: RequestId, result: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  /** Answer a server request with an error, e.g. one this client cannot serve. */
  respondError(id: RequestId, code: number, message: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  onNotification(l: NotificationListener): () => void {
    this.notificationListeners.add(l);
    return () => this.notificationListeners.delete(l);
  }

  onServerRequest(l: ServerRequestListener): () => void {
    this.serverRequestListeners.add(l);
    return () => this.serverRequestListeners.delete(l);
  }

  onStateChange(l: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  private readonly kick = () => {
    if (this.state !== "open") this.connectNow();
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === "visible") this.kick();
  };

  private connectNow(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    if (this.stopped || this.state === "connecting" || this.state === "open") return;
    this.setState("connecting");
    const ws = new WebSocket(this.opts.url, ["cp1", `tok.${this.opts.token}`]);
    this.ws = ws;
    ws.onopen = () => {
      if (this.stopped || this.ws !== ws) return;
      this.attempt = 0;
      this.setState("open");
    };
    ws.onmessage = (ev) => { if (!this.stopped && this.ws === ws) this.handleMessage(String(ev.data)); };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.rejectAllPending("connection closed");
      if (event.code === 4001) { this.stopped = true; this.revoked = true; }
      this.setState("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const schedule = this.opts.backoffMs;
    const delay = schedule[Math.min(this.attempt, schedule.length - 1)];
    this.attempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setState(s: ConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  private rejectAllPending(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RpcError(CONNECTION_ERROR, reason));
    }
    this.pending.clear();
  }

  private handleMessage(text: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(text) as JsonRpcMessage;
    } catch {
      return;
    }
    if ("method" in msg) {
      if ("id" in msg) for (const l of this.serverRequestListeners) l(msg as JsonRpcRequest);
      else for (const l of this.notificationListeners) l(msg as JsonRpcNotification);
      return;
    }
    if (!("id" in msg)) return;
    const res = msg as JsonRpcResponse;
    const p = this.pending.get(res.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(res.id);
    if (res.error) p.reject(new RpcError(res.error.code, res.error.message, res.error.data));
    else p.resolve(res.result);
  }
}
