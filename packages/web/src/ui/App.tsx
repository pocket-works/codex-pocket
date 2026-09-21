import { useEffect, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { NewThread } from "./NewThread.js";
import { ThreadList } from "./ThreadList.js";
import { ThreadView } from "./ThreadView.js";
import { useRoute } from "./route.js";
import { ArchivedList } from "./ArchivedList.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { checkForUpdate } from "../state/updates.js";

export function App({ session }: { session: Session }) {
  const route = useRoute();
  const connection = useStore(session.store, (s) => s.connection);
  const upstream = useStore(session.store, (s) => s.upstreamConnected);
  const notices = useStore(session.store, (s) => s.notices);

  // Keep the open thread in sync with the URL.
  useEffect(() => {
    if (route.name === "thread") void session.openThread(route.id);
    else if (route.name === "new") session.openDraft(route.cwd ?? "");
    else void session.closeThread();
  }, [route.name === "thread" ? route.id : route.name, session]);

  // On the LAN the socket is back in under a second, so a blip (waking the
  // phone, switching Wi-Fi) should not flash a banner at all: only mention a
  // problem once it has lasted a moment. If the socket is still not open
  // after STUCK_AFTER_MS, the Mac is unreachable — with Tailscale off on the
  // phone the connect hangs rather than fails — so say so instead of spinning.
  const trouble = connection !== "open" || !upstream;
  const showBanner = useStuck(trouble, BANNER_AFTER_MS);
  const stuck = useStuck(connection !== "open", STUCK_AFTER_MS);
  const updated = useUpdateAvailable(connection === "open");

  const banner = !showBanner
    ? null
    : connection !== "open"
      ? stuck
        ? "Can't reach your Mac. Away from home? Check that Tailscale is on."
        : "Connecting to your Mac…"
      : !upstream
        ? "Mac reached, waiting for Codex app-server…"
        : null;

  return (
    <div className="app">
      {banner && <div className="banner">{banner}</div>}
      {updated && !banner && (
        <button className="banner update" onClick={() => location.reload()}>
          Codex Pocket was updated — tap to reload
        </button>
      )}
      {notices.map((n) => (
        <div key={n.id} className="alert warning">
          <span>{n.message}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => session.dismissNotice(n.id)}>
            ×
          </button>
        </div>
      ))}
      {route.name === "list" && <ThreadList session={session} />}
      {route.name === "new" && <NewThread session={session} presetCwd={route.cwd} />}
      {route.name === "archived" && <ArchivedList session={session} />}
      {route.name === "settings" && <SettingsScreen session={session} />}
      {route.name === "thread" && <ThreadView session={session} />}
    </div>
  );
}

const BANNER_AFTER_MS = 1500;
/** Do not hammer the host: one update check per this interval at most. */
const UPDATE_CHECK_MIN_GAP_MS = 60_000;
const STUCK_AFTER_MS = 8000;

/** True once `active` has held for `ms`; resets as soon as it drops. */
function useStuck(active: boolean, ms: number): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!active) {
      setStuck(false);
      return;
    }
    const timer = window.setTimeout(() => setStuck(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return stuck;
}

// The host was rebuilt while this page stayed open. Checked when the socket
// comes (back) up and when the app returns to the foreground, since those
// are the moments a phone that sat in a pocket meets a new build.
function useUpdateAvailable(connected: boolean): boolean {
  const [updated, setUpdated] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    if (updated) return;
    const check = () => {
      if (Date.now() - last.current < UPDATE_CHECK_MIN_GAP_MS) return;
      last.current = Date.now();
      void checkForUpdate().then((changed) => changed && setUpdated(true));
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    if (connected) check();
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [connected, updated]);
  return updated;
}
