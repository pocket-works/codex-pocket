import type WebSocket from "ws";
import { openAppServerWebSocket, unixSocketUrl } from "./websocket.js";

export function openUnixWebSocket(socketPath: string, timeoutMs?: number): Promise<WebSocket> {
  return openAppServerWebSocket(unixSocketUrl(socketPath), timeoutMs);
}
