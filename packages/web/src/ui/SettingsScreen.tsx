import { useEffect, useState } from "react";
import { setToken } from "../state/auth.js";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { navigate } from "./route.js";

interface Me {
  device: { id: string; name: string; createdAt: number };
  upstream: boolean;
}

export function SettingsScreen({ session }: { session: Session }) {
  const connection = useStore(session.store, (s) => s.connection);
  const upstream = useStore(session.store, (s) => s.upstreamConnected);
  const [me, setMe] = useState<Me | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("codex-pocket.token");
    if (!token) return;
    fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then((m) => setMe(m))
      .catch(() => setMe(null));
  }, []);

  function unpair() {
    setToken(null);
    location.replace("/#/");
    location.reload();
  }

  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <h1>Settings</h1>
      </header>
      <div className="settings">
        <div className="setting-group">
          <div className="setting-row">
            <span>Host</span>
            <span className="setting-value muted">{location.host}</span>
          </div>
          <div className="setting-row">
            <span>Connection</span>
            <span className="setting-value muted">{connection === "open" ? (upstream ? "Codex connected" : "Waiting for Codex") : "Reconnecting…"}</span>
          </div>
          <div className="setting-row">
            <span>This device</span>
            <span className="setting-value muted">{me ? `${me.device.name} · ${me.device.id.slice(0, 8)}` : "–"}</span>
          </div>
          {me && (
            <div className="setting-row">
              <span>Paired</span>
              <span className="setting-value muted">{new Date(me.device.createdAt).toLocaleDateString()}</span>
            </div>
          )}
        </div>
        <div className="setting-group">
          {confirm ? (
            <div className="setting-row">
              <span>Forget this device?</span>
              <span className="setting-value">
                <button onClick={() => setConfirm(false)}>Cancel</button>
                <button className="danger" onClick={unpair}>
                  Unpair
                </button>
              </span>
            </div>
          ) : (
            <button className="setting-row danger-row" onClick={() => setConfirm(true)}>
              Unpair this device
            </button>
          )}
        </div>
        <p className="muted small center">
          To pair another phone, run <code>codex-pocket pair</code> on the Mac.
        </p>
      </div>
    </main>
  );
}
