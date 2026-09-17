// Hand-written entry point. This package is types-only: nothing here may
// exist at runtime, so consumers always `import type` from it.
// Everything under ./generated is produced by
// `pnpm generate` (codex app-server generate-ts) and must not be edited.

export type * from "./generated/index.js";
export type * as v2 from "./generated/v2/index.js";

import type { ClientRequest } from "./generated/ClientRequest.js";
import type { ServerRequest } from "./generated/ServerRequest.js";
import type { ServerNotification } from "./generated/ServerNotification.js";
import type { RequestId } from "./generated/RequestId.js";

// --- JSON-RPC 2.0 wire envelopes -------------------------------------------
// The generated code describes payloads (method + params) but not the wire
// framing, so we define the minimal envelope shapes here.

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
  emittedAtMs?: number;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id: RequestId;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// --- Typed method maps ------------------------------------------------------
// Derive `{ method: params }` and `{ method: response }` lookups from the
// generated discriminated unions so callers get end-to-end typing.

export type ClientMethod = ClientRequest["method"];
export type ClientParams<M extends ClientMethod> = Extract<ClientRequest, { method: M }>["params"];

export type ServerRequestMethod = ServerRequest["method"];
export type ServerRequestParams<M extends ServerRequestMethod> = Extract<ServerRequest, { method: M }>["params"];

export type ServerNotificationMethod = ServerNotification["method"];
export type ServerNotificationParams<M extends ServerNotificationMethod> = Extract<ServerNotification, { method: M }>["params"];
