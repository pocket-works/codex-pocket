import type { Computer } from "../state/computers.js";
import { HostHttpError, type HostInfo } from "../state/host-client.js";
import type { Session } from "../state/session.js";

const disconnected = { connection: "closed", upstreamConnected: false };
const noSubscription = () => () => {};
const disconnectedSnapshot = () => disconnected;

export function useConnectionState(session: Session | null) {
  const snapshot = session?.store.get ?? disconnectedSnapshot;
  return useSyncExternalStore<{ connection: string; upstreamConnected: boolean }>(session?.store.subscribe ?? noSubscription, snapshot, snapshot);
}

export function computerConnection(computer: Computer, info: HostInfo): string {
  if (computer.instanceId && info.instanceId !== computer.instanceId) return "Pair again";
  if (computer.origin !== location.origin && info.apiVersion !== 2) return "Update Pocket on this Mac";
  return info.upstream ? "Connected" : "Waiting for Codex";
}

export function computerConnectionError(error: unknown): string {
  return (error instanceof HostHttpError && error.status === 401) || /identity changed/.test(String(error)) ? "Pair again" : "Unreachable";
}
import { useSyncExternalStore } from "react";
