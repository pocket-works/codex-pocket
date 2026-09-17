import type WebSocket from "ws";
import type {
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  RequestId,
} from "@codex-pocket/protocol";

export class JsonRpcRemoteError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(err: JsonRpcError) {
    super(err.message);
    this.name = "JsonRpcRemoteError";
    this.code = err.code;
    this.data = err.data;
  }
}

// Throw this from a server-request handler when the request was resolved by
// someone else (Codex reports `serverRequest/resolved`); no reply is sent.
export class ServerRequestAbandoned extends Error {
  constructor() {
    super("server request abandoned");
    this.name = "ServerRequestAbandoned";
  }
}

export type NotificationListener = (notification: JsonRpcNotification) => void;
export type ServerRequestHandler = (request: JsonRpcRequest) => Promise<unknown>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

// Bidirectional JSON-RPC 2.0 over one WebSocket. Transport-agnostic beyond
// that: it knows nothing about Codex methods.
export class JsonRpcConnection {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<RequestId, Pending>();
  private readonly notificationListeners = new Set<NotificationListener>();
  private serverRequestHandler: ServerRequestHandler | null = null;
  private readonly closeListeners = new Set<(reason: string) => void>();
  private closed = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => this.handleRaw(raw.toString()));
    ws.on("close", (code, reason) => this.handleClose(`socket closed (${code} ${reason.toString()})`));
    ws.on("error", (err) => this.handleClose(`socket error: ${err.message}`));
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (this.closed) return Promise.reject(new Error("connection closed"));
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  // Only one handler: the server expects exactly one answer per request.
  onServerRequest(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.ws.close();
    this.handleClose("closed locally");
  }

  private send(msg: JsonRpcMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  private handleRaw(text: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(text) as JsonRpcMessage;
    } catch {
      return;
    }
    if ("method" in msg) {
      if ("id" in msg) this.handleServerRequest(msg as JsonRpcRequest);
      else this.dispatchNotification(msg as JsonRpcNotification);
      return;
    }
    if ("id" in msg) this.handleResponse(msg as JsonRpcResponse);
  }

  private handleResponse(res: JsonRpcResponse): void {
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    if (res.error) p.reject(new JsonRpcRemoteError(res.error));
    else p.resolve(res.result);
  }

  private dispatchNotification(n: JsonRpcNotification): void {
    for (const l of this.notificationListeners) l(n);
  }

  private async handleServerRequest(req: JsonRpcRequest): Promise<void> {
    const handler = this.serverRequestHandler;
    if (!handler) {
      this.send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `no handler for ${req.method}` } });
      return;
    }
    try {
      const result = await handler(req);
      this.send({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      if (err instanceof ServerRequestAbandoned) return;
      if (this.closed) return;
      const message = err instanceof Error ? err.message : String(err);
      this.send({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } });
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error(`connection closed before response: ${reason}`));
    this.pending.clear();
    for (const l of this.closeListeners) l(reason);
  }
}
