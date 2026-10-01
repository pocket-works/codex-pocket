import { useEffect, useRef, useState } from "react";
import type { ComputerRegistry } from "../state/computers.js";
import { friendlyError } from "../state/errors.js";
import type { HostClient } from "../state/host-client.js";
import { disablePush, enablePush, pushStatus, type PushStatus } from "../state/push.js";
import { RefreshIcon } from "./icons.js";

function savePreference(host: HostClient, registry: ComputerRegistry | undefined, status: PushStatus) {
  const saved = registry?.store.get().computers.find((computer) => computer.id === host.id);
  const enabled = status === "on";
  if (saved?.token === host.computer.token && saved.notifications !== enabled) registry?.update(host.id, { notifications: enabled });
}

export function NotificationSetting({ host, registry, notifications }: { host: HostClient; registry?: ComputerRegistry; notifications?: boolean }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    let live = true;
    const reading = ++request.current;
    setError(null);
    void pushStatus(host).then((next) => {
      if (live && reading === request.current) {
        setStatus(next);
        if (next === "on" || next === "off") savePreference(host, registry, next);
      }
    }).catch((err) => {
      if (live && reading === request.current) { setStatus(null); setError(friendlyError(err)); }
    });
    return () => { live = false; };
  }, [host, registry, notifications, attempt]);

  async function toggle() {
    if (busy || (status !== "on" && status !== "off")) return;
    ++request.current;
    setBusy(true);
    setError(null);
    try {
      const next = await (status === "on" ? disablePush(host) : enablePush(host));
      savePreference(host, registry, next);
      if (!host.disposed) setStatus(next);
    } catch (err) {
      if (!host.disposed) setError(friendlyError(err));
    } finally { setBusy(false); }
  }

  return <>
    <div className="setting-row">
      <span>Notifications</span>
      <span className="setting-value">
        {status === "on" || status === "off" ? (
          <button role="switch" aria-checked={status === "on"} className={`switch ${status === "on" ? "on" : ""}`} disabled={busy} onClick={() => void toggle()} aria-label="Notifications" />
        ) : (
          <span className="muted small">{status == null ? error ? "Unavailable" : "Checking…" : status === "needs-install" ? "Needs Home Screen app" : status === "denied" ? "Blocked in phone settings" : "Not supported on this phone"}</span>
        )}
        {error && status == null && <button className="icon-btn" aria-label="Retry notification status" title="Retry" onClick={() => setAttempt((n) => n + 1)}><RefreshIcon /></button>}
      </span>
    </div>
    {error && <p className="error small setting-note" role="alert">{error}</p>}
  </>;
}
