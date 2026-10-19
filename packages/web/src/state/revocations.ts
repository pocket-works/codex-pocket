import type { ComputerRegistry, PendingRevocation } from "./computers.js";
import { HostClient } from "./host-client.js";
import { forgetPush } from "./push.js";

/**
 * Best-effort delivery of a revocation that could not reach the computer when
 * it was removed from the phone. A 401 means the token is already invalid, so
 * the outstanding record can be settled either way.
 */
export async function retryRevocation(registry: ComputerRegistry, pending: PendingRevocation): Promise<boolean> {
  const host = new HostClient({ ...pending, lastRoute: "#/", notifications: false });
  try {
    const response = await host.fetch("/api/device", { method: "DELETE" });
    // 401 means this credential is already invalid. Any other non-success
    // status, including a 403 origin mismatch, still needs a later attempt.
    if (!response.ok && response.status !== 401) return false;
    try { await forgetPush(host); } catch {}
    registry.clearPendingRevocation(pending.id, pending.token);
    return true;
  } catch {
    return false;
  } finally {
    host.dispose();
  }
}

export async function retryPendingRevocations(registry: ComputerRegistry): Promise<void> {
  for (const pending of registry.store.get().pendingRevocations) {
    await retryRevocation(registry, pending);
  }
}
