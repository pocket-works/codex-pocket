import type { InitializeParams, InitializeResponse, v2 } from "@codex-pocket/protocol";
import { JsonRpcConnection, type NotificationListener, type ServerRequestHandler } from "./jsonrpc-connection.js";
import { openAppServerWebSocket, unixSocketUrl } from "./websocket.js";
import { ensureDaemon, type DaemonRunner } from "./locate.js";

// Response types for the client methods we call. The generated union only
// covers params, so the result side is declared here for the subset we use.
export interface ResponseMap {
  "thread/list": v2.ThreadListResponse;
  "thread/start": v2.ThreadStartResponse;
  "thread/resume": v2.ThreadResumeResponse;
  "thread/read": v2.ThreadReadResponse;
  "thread/items/list": v2.ThreadItemsListResponse;
  "turn/start": v2.TurnStartResponse;
  "turn/interrupt": v2.TurnInterruptResponse;
  "model/list": v2.ModelListResponse;
}

export interface ParamsMap {
  "thread/list": v2.ThreadListParams;
  "thread/start": v2.ThreadStartParams;
  "thread/resume": v2.ThreadResumeParams;
  "thread/read": v2.ThreadReadParams;
  "thread/items/list": v2.ThreadItemsListParams;
  "turn/start": v2.TurnStartParams;
  "turn/interrupt": v2.TurnInterruptParams;
  "model/list": v2.ModelListParams;
}

export type KnownMethod = keyof ResponseMap & keyof ParamsMap;

export interface CodexClientOptions {
  clientName?: string;
  clientVersion?: string;
  /** Connect to this app-server WebSocket URL (ws://host:port/ or ws+unix://…). */
  url?: string;
  /** Shorthand for `url` with a unix socket path. */
  socketPath?: string;
  /** Without url/socketPath: locate the official daemon through `codex app-server daemon start`. */
  daemonRunner?: DaemonRunner;
  connectTimeoutMs?: number;
}

// One authenticated session with the Codex app-server. Wraps the raw
// JSON-RPC connection with the initialize handshake and typed helpers.
export class CodexClient {
  readonly conn: JsonRpcConnection;
  readonly serverInfo: InitializeResponse;
  /** Where this client is connected (WebSocket URL). */
  readonly url: string;

  private constructor(conn: JsonRpcConnection, serverInfo: InitializeResponse, url: string) {
    this.conn = conn;
    this.serverInfo = serverInfo;
    this.url = url;
  }

  static async connect(opts: CodexClientOptions = {}): Promise<CodexClient> {
    const url = opts.url ?? unixSocketUrl(opts.socketPath ?? (await ensureDaemon(opts.daemonRunner)).socketPath);
    const ws = await openAppServerWebSocket(url, opts.connectTimeoutMs);
    const conn = new JsonRpcConnection(ws);
    const params: InitializeParams = {
      clientInfo: {
        name: opts.clientName ?? "codex-pocket",
        title: "Codex Pocket",
        version: opts.clientVersion ?? "0.1.0",
      },
      // The desktop app sets this too; thread/queue/* is gated behind it.
      capabilities: { experimentalApi: true, requestAttestation: false },
    };
    let serverInfo: InitializeResponse;
    try {
      serverInfo = await conn.request<InitializeResponse>("initialize", params);
    } catch (err) {
      conn.close();
      throw err;
    }
    conn.notify("initialized");
    return new CodexClient(conn, serverInfo, url);
  }

  call<M extends KnownMethod>(method: M, params: ParamsMap[M]): Promise<ResponseMap[M]> {
    return this.conn.request<ResponseMap[M]>(method, params);
  }

  /** Escape hatch for methods not in ResponseMap (used by the transparent proxy). */
  rawRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.conn.request<T>(method, params);
  }

  onNotification(listener: NotificationListener): () => void {
    return this.conn.onNotification(listener);
  }

  onServerRequest(handler: ServerRequestHandler): void {
    this.conn.onServerRequest(handler);
  }

  onClose(listener: (reason: string) => void): () => void {
    return this.conn.onClose(listener);
  }

  close(): void {
    this.conn.close();
  }
}
