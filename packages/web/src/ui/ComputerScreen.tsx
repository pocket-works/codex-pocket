import { useEffect, useMemo, useState } from "react";
import type { Computer, ComputerRegistry } from "../state/computers.js";
import { HostClient, HostHttpError, type HostInfo } from "../state/host-client.js";
import { forgetPush } from "../state/push.js";
import type { Session } from "../state/session.js";
import { createStore, useStore } from "../state/store.js";
import { useDialog } from "./dialog.js";
import { useSwipeBack } from "./gestures.js";
import { PencilIcon, RefreshIcon } from "./icons.js";
import { NotificationSetting } from "./NotificationSetting.js";
import { computerConnection, computerConnectionError, useConnectionState } from "./computer-connection.js";

const idle = createStore(0);

export function ComputerScreen({ computer, registry, session, onBack, onUse, onPair, onRemove }: {
  computer: Computer;
  registry: ComputerRegistry;
  session: Session | null;
  onBack: () => void;
  onUse: (computer: Computer) => void;
  onPair: () => void;
  onRemove: (computer: Computer) => void;
}) {
  const host = useMemo(() => new HostClient(computer), [computer.id, computer.origin, computer.token]);
  const pending = useStore(session?.operations ?? idle, (s) => s);
  const { connection, upstreamConnected: upstream } = useConnectionState(session);
  const [info, setInfo] = useState<HostInfo | null>(null);
  const [status, setStatus] = useState("Checking…");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [localRemoval, setLocalRemoval] = useState(false);
  const close = () => { if (!busy) onBack(); };
  const dialog = useDialog(computer.name, close);
  const back = useSwipeBack(close);
  const current = computer.id === registry.active?.id;

  useEffect(() => () => host.dispose(), [host]);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setStatus("Checking…");
    void host.fetch("/api/me", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) }).then(async (response) => {
      if (!response.ok) throw new HostHttpError(response.status);
      const next = await response.json() as HostInfo;
      if (live) { setInfo(next); setStatus(computerConnection(host.computer, next)); }
    }).catch((error) => { if (live) { setInfo(null); setStatus(computerConnectionError(error)); } });
    return () => { live = false; controller.abort(); };
  }, [host, attempt]);

  async function remove() {
    if (busy || pending || !window.confirm(`Remove ${computer.name} and revoke this phone's access?`)) return;
    setBusy(true); setFailure(null); setLocalRemoval(false);
    const removalHost = new HostClient(computer);
    try {
      const response = await removalHost.fetch("/api/device", { method: "DELETE" });
      if (!response.ok && response.status !== 401) throw new HostHttpError(response.status);
      await forgetPush(removalHost);
      onRemove(computer);
    } catch {
      setLocalRemoval(true);
      setFailure(`Could not revoke access on ${computer.name}. Local removal leaves its pairing on the Mac; revoke it there later.`);
    } finally { removalHost.dispose(); setBusy(false); }
  }

  async function removeLocal() {
    setBusy(true);
    const removalHost = new HostClient(computer);
    try { await forgetPush(removalHost); } catch {}
    finally { removalHost.dispose(); onRemove(computer); setBusy(false); }
  }

  const liveStatus = current && session?.host?.id === computer.id && connection === "open" && status !== "Pair again" && status !== "Update Pocket on this Mac" ? upstream ? "Connected" : "Waiting for Codex" : status;
  const fallback = status === "Checking…" ? status : "Unavailable";
  return <div className={`screen computer-screen ${back.dragging ? "dragging" : ""}`} ref={dialog.ref} {...dialog.props} style={back.style} {...back.handlers}>
    <header className="topbar">
      <button className="icon-btn" aria-label="Back" title="Back" disabled={busy} onClick={close}>‹</button>
      <div className="topbar-title"><h1>{computer.name}</h1><div className="muted small">{current && "Current computer · "}{liveStatus}</div></div>
      <button className="icon-btn" aria-label={`Rename ${computer.name}`} title="Rename" disabled={busy} onClick={() => {
        const name = window.prompt("Computer name", computer.name)?.trim().slice(0, 64);
        if (name) registry.update(computer.id, { name });
      }}><PencilIcon /></button>
    </header>
    <div className="computer-content">
      {liveStatus === "Unreachable" && <div className="computer-recovery" role="status"><span>Check this Mac's connection and Tailscale.</span><button className="icon-btn" aria-label="Refresh connection" title="Refresh connection" onClick={() => setAttempt((n) => n + 1)}><RefreshIcon /></button></div>}
      {!current && <button className="primary computer-use" disabled={Boolean(pending || busy)} onClick={() => onUse(computer)}>Use this computer</button>}
      <NotificationSetting host={host} registry={registry} notifications={computer.notifications} />
      <div className="computer-maintenance">
        <button className={`setting-row computer-setting ${liveStatus === "Pair again" ? "needs-pairing" : ""}`} disabled={Boolean(pending || busy)} onClick={onPair}><span>Pair again</span><RefreshIcon /></button>
        <button className="setting-row danger-row" disabled={Boolean(pending || busy)} onClick={() => void remove()}>{busy ? "Removing…" : "Remove computer"}</button>
      </div>
      {pending > 0 && <p className="muted small" role="status">Finishing a send or upload…</p>}
      {failure && <p className="error small" role="alert">{failure}</p>}
      {localRemoval && <div className="approval-actions"><button disabled={busy} onClick={() => { setLocalRemoval(false); setFailure(null); }}>Cancel</button><button className="danger" disabled={Boolean(pending || busy)} onClick={() => void removeLocal()}>Remove locally</button></div>}
      <section className="computer-diagnostics" aria-labelledby="connection-details-title">
        <h2 id="connection-details-title">Connection details</h2>
        <div className="setting-row"><span>Address</span><span className="setting-value muted">{computer.origin}</span></div>
        <div className="setting-row"><span>This phone</span><span className="setting-value muted">{info?.device.name ?? fallback}</span></div>
        <div className="setting-row"><span>Pairing ID</span><span className="setting-value muted">{info?.device.id ?? computer.deviceId ?? fallback}</span></div>
        <div className="setting-row"><span>Paired</span><span className="setting-value muted">{info ? new Date(info.device.createdAt).toLocaleDateString() : fallback}</span></div>
      </section>
    </div>
  </div>;
}
