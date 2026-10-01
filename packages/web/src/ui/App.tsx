import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { NewThread } from "./NewThread.js";
import { ThreadList } from "./ThreadList.js";
import { ThreadView } from "./ThreadView.js";
import { navigate, useRoute } from "./route.js";
import { ArchivedList } from "./ArchivedList.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { checkForUpdate } from "../state/updates.js";

export function App({ session }: { session: Session }) {
  const route = useRoute();
  const connection = useStore(session.store, (s) => s.connection);
  const upstream = useStore(session.store, (s) => s.upstreamConnected);
  const notices = useStore(session.store, (s) => s.notices);
  const toasts = useStore(session.store, (s) => s.toasts);
  const openId = useStore(session.store, (s) => s.open?.view.threadId ?? null);
  // Threads blocked on you that are not the one on screen. The list shows
  // its own marks, so the strip appears on the other screens only.
  const threads = useStore(session.store, (s) => s.threads);
  const waiting = useMemo(() => threads.filter((t) => t.status === "waiting" && t.id !== openId), [threads, openId]);

  // Keep the open thread in sync with the URL.
  useEffect(() => {
    if (route.name === "thread") void session.openThread(route.id);
    else if (route.name === "new") session.openDraft(route.cwd ?? "");
    else void session.closeThread();
  }, [route.name === "thread" ? route.id : route.name, session]);

  // A thread opened directly (a push notification, a reload) never showed
  // the list, which is where titles come from; fetch it in the background.
  useEffect(() => {
    if (connection === "open" && route.name === "thread" && session.store.get().threads.length === 0) void session.loadThreads();
  }, [connection, route.name, session]);

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
        ? "Can't reach your Mac. Make sure Codex Pocket is running and Tailscale is on when away from home. Reconnecting..."
        : "Connecting to your Mac…"
      : !upstream
        ? "Mac reached, waiting for Codex app-server…"
        : null;

  // An iPad or a desktop window: the list stays on the left and the
  // screens open beside it, like the official app's sidebar.
  const split = useMediaQuery(SPLIT_QUERY);
  const screen = (
    <>
      {route.name === "new" && <NewThread session={session} presetCwd={route.cwd} />}
      {route.name === "archived" && <ArchivedList session={session} />}
      {route.name === "settings" && <SettingsScreen session={session} />}
      {route.name === "thread" && <ThreadView session={session} />}
    </>
  );

  return (
    <div className={`app ${split ? "split" : ""}`}>
      {banner && <div className="banner">{banner}</div>}
      {updated && !banner && (
        <button className="banner update" onClick={() => location.reload()}>
          Codex Pocket was updated — tap to reload
        </button>
      )}
      {route.name !== "list" && waiting.length > 0 && (
        <button className="event-strip" onClick={() => navigate(waiting.length === 1 ? { name: "thread", id: waiting[0].id } : { name: "list" })}>
          <span className="event-dot" aria-hidden />
          <span className="event-text">
            {waiting.length === 1 ? `${waiting[0].title} is waiting for your ${waiting[0].waitingFor === "input" ? "answer" : "approval"}` : `${waiting.length} threads are waiting for you`}
          </span>
          <span aria-hidden>›</span>
        </button>
      )}
      {toasts.map((t) => (
        <button key={t.id} className="event-strip done" onClick={() => (session.dismissToast(t.id), navigate({ name: "thread", id: t.threadId }))}>
          <span className="event-dot" aria-hidden />
          <span className="event-text">{t.message}</span>
          <span aria-hidden>›</span>
        </button>
      ))}
      {notices.map((n) => (
        <div key={n.id} className="alert warning">
          <span>{n.message}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => session.dismissNotice(n.id)}>
            ×
          </button>
        </div>
      ))}
      {split ? (
        <div className="split-body">
          <aside className="split-list">
            <ThreadList session={session} />
          </aside>
          <section className="split-main">
            {route.name === "list" ? <p className="muted center split-empty">Pick a thread, or start one.</p> : screen}
          </section>
        </div>
      ) : (
        <>
          {route.name === "list" && <ThreadList session={session} />}
          {screen}
        </>
      )}
    </div>
  );
}

const SPLIT_QUERY = "(min-width: 900px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
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
