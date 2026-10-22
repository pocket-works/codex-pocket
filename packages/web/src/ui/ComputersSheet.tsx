import { useEffect, useState } from "react";
import type { Computer, ComputerRegistry, PendingRevocation } from "../state/computers.js";
import { HostClient, HostHttpError } from "../state/host-client.js";
import type { Session } from "../state/session.js";
import { createStore, useStore } from "../state/store.js";
import { useDialog } from "./dialog.js";
import { AlertIcon, CheckIcon, InfoIcon, MonitorIcon, PlusIcon, RefreshIcon, TrashIcon } from "./icons.js";
import { computerConnection, computerConnectionError, useConnectionState } from "./computer-connection.js";
import { forgetPush } from "../state/push.js";
import { retryRevocation } from "../state/revocations.js";

const idle = createStore(0);

export function ComputersSheet({ registry, session, onChoose, onDetails, onRemove, onAdd, onClose }: {
  registry: ComputerRegistry;
  session: Session | null;
  onChoose: (computer: Computer) => void;
  onDetails: (id: string) => void;
  onRemove: (computer: Computer, revokeLater: boolean) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const state = useStore(registry.store, (s) => s);
  const pending = useStore(session?.operations ?? idle, (s) => s);
  const { connection, upstreamConnected: upstream } = useConnectionState(session);
  const dialog = useDialog("Computers", onClose);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const signature = state.computers.map((c) => `${c.id}:${c.origin}:${c.token}`).join("|");

  useEffect(() => {
    let live = true;
    const hosts = state.computers.map((c) => new HostClient(c));
    setStatuses({});
    for (const host of hosts) {
      void host.fetch("/api/me", { signal: AbortSignal.timeout(4000) }).then(async (response) => {
        if (!response.ok) {
          throw new HostHttpError(response.status);
        }
        const status = computerConnection(host.computer, await response.json());
        if (live) setStatuses((previous) => ({ ...previous, [host.id]: status }));
      }).catch((error) => { if (live) setStatuses((previous) => ({ ...previous, [host.id]: computerConnectionError(error) })); });
    }
    return () => { live = false; for (const host of hosts) host.dispose(); };
  }, [signature]);

  function status(computer: Computer): string {
    const snapshot = statuses[computer.id];
    if (computer.id === session?.host?.id && connection === "open" && snapshot !== "Pair again" && snapshot !== "Update Pocket on this computer") return upstream ? "Connected" : "Waiting for Codex";
    return snapshot ?? "Checking…";
  }

  async function remove(computer: Computer) {
    if (pending || removing || !window.confirm(`Remove ${computer.name}?\n\nThis will try to revoke this phone's access. Chats on the computer will not be deleted.`)) return;
    setRemoving(computer.id);
    const host = new HostClient(computer);
    try {
      // Removing the computer from this phone is a local, synchronous action.
      // Never leave it visible while an unreachable VM's network request times
      // out. The retained token lets the background revocation retry later.
      onRemove(computer, true);
      const retained = registry.store.get().pendingRevocations.find((p) => p.id === computer.id && p.token === computer.token);
      if (!retained) {
        host.dispose();
        return;
      }
      void (async () => {
        try {
          await retryRevocation(registry, retained);
          try { await forgetPush(host); } catch {}
        } finally {
          host.dispose();
        }
      })();
    } finally {
      setRemoving(null);
    }
  }

  async function retry(id: string, token: string) {
    if (retrying) return;
    setRetrying(`${id}:${token}`);
    const pending = registry.store.get().pendingRevocations.find((p) => p.id === id && p.token === token);
    if (!pending) { setRetrying(null); return; }
    try {
      await retryRevocation(registry, pending);
    } finally {
      setRetrying(null);
    }
  }

  function forget(pending: PendingRevocation) {
    if (!window.confirm(`Forget ${pending.name} permanently?\n\nPocket will discard the saved credential and stop trying to revoke this phone's access. This phone's access on that computer cannot be revoked from here later.`)) return;
    registry.clearPendingRevocation(pending.id, pending.token);
  }

  return <div className="sheet-backdrop" onClick={onClose}>
    <div className="sheet computers-sheet" ref={dialog.ref} {...dialog.props} onClick={(event) => event.stopPropagation()}>
      <div className="sheet-grip" />
      <div className="computer-sheet-heading"><h2>Computers</h2><button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>×</button></div>
      <ul className="computer-list">
        {state.computers.map((computer) => <li key={computer.id}>
          <div className="computer-row">
            <button className="computer-choice" disabled={pending > 0} onClick={() => { if (!pending) onChoose(computer); }} aria-current={computer.id === state.activeId ? "true" : undefined}>
              <MonitorIcon /><span className="computer-details"><strong>{computer.name}</strong><span className="small muted">{computer.id === state.activeId ? "Current · " : ""}{status(computer)}</span></span>{computer.id === state.activeId && <CheckIcon />}
            </button>
            <button className="icon-btn computer-info" aria-label={`Details for ${computer.name}`} title="Computer details" onClick={() => onDetails(computer.id)}><InfoIcon /></button>
            <button className="icon-btn computer-remove" aria-label={`Remove ${computer.name}`} title="Remove computer" disabled={pending > 0 || removing !== null} aria-busy={removing === computer.id} onClick={() => void remove(computer)}><TrashIcon /></button>
          </div>
        </li>)}
      </ul>
      {state.pendingRevocations.length > 0 && <section className="computer-pending" aria-labelledby="pending-revocations-title">
        <h2 id="pending-revocations-title">Revocation pending</h2>
        <p className="muted small">Removed from this phone. Pocket will revoke this phone's old access when the computer is reachable. If it will never return, forget the saved credential permanently.</p>
        {state.pendingRevocations.map((pending) => <div className="computer-pending-row" key={`${pending.id}:${pending.token}`}>
          <AlertIcon />
          <span className="computer-details"><strong>{pending.name}</strong><span className="small muted">{pending.origin}</span></span>
          <button className="icon-btn" aria-label={`Retry revoking ${pending.name}`} title="Retry revocation" disabled={retrying !== null} onClick={() => void retry(pending.id, pending.token)}><RefreshIcon /></button>
          <button className="icon-btn" aria-label={`Forget ${pending.name} permanently`} title="Forget permanently" disabled={retrying !== null} onClick={() => forget(pending)}><TrashIcon /></button>
        </div>)}
      </section>}
      {pending > 0 && <p className="muted small" role="status">Finishing a send or upload…</p>}
      <button className="computer-add" disabled={pending > 0} onClick={onAdd}><PlusIcon /><span>Add computer</span></button>
    </div>
  </div>;
}
