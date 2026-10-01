import { useEffect, useState } from "react";
import type { Computer, ComputerRegistry } from "../state/computers.js";
import { HostClient, HostHttpError } from "../state/host-client.js";
import type { Session } from "../state/session.js";
import { createStore, useStore } from "../state/store.js";
import { useDialog } from "./dialog.js";
import { CheckIcon, InfoIcon, MonitorIcon, PlusIcon } from "./icons.js";
import { computerConnection, computerConnectionError, useConnectionState } from "./computer-connection.js";

const idle = createStore(0);

export function ComputersSheet({ registry, session, onChoose, onDetails, onAdd, onClose }: {
  registry: ComputerRegistry;
  session: Session | null;
  onChoose: (computer: Computer) => void;
  onDetails: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const state = useStore(registry.store, (s) => s);
  const pending = useStore(session?.operations ?? idle, (s) => s);
  const { connection, upstreamConnected: upstream } = useConnectionState(session);
  const dialog = useDialog("Computers", onClose);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
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
    if (computer.id === session?.host?.id && connection === "open" && snapshot !== "Pair again" && snapshot !== "Update Pocket on this Mac") return upstream ? "Connected" : "Waiting for Codex";
    return snapshot ?? "Checking…";
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
          </div>
        </li>)}
      </ul>
      {pending > 0 && <p className="muted small" role="status">Finishing a send or upload…</p>}
      <button className="computer-add" disabled={pending > 0} onClick={onAdd}><PlusIcon /><span>Add computer</span></button>
    </div>
  </div>;
}
