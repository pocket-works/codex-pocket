import { useEffect } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { NewThread } from "./NewThread.js";
import { ThreadList } from "./ThreadList.js";
import { ThreadView } from "./ThreadView.js";
import { useRoute } from "./route.js";

export function App({ session }: { session: Session }) {
  const route = useRoute();
  const connection = useStore(session.store, (s) => s.connection);
  const upstream = useStore(session.store, (s) => s.upstreamConnected);
  const notices = useStore(session.store, (s) => s.notices);

  // Keep the open thread in sync with the URL.
  useEffect(() => {
    if (route.name === "thread") void session.openThread(route.id);
    else void session.closeThread();
  }, [route.name === "thread" ? route.id : route.name, session]);

  const banner =
    connection !== "open" ? "Connecting to your Mac…" : !upstream ? "Mac reached, waiting for Codex app-server…" : null;

  return (
    <div className="app">
      {banner && <div className="banner">{banner}</div>}
      {notices.map((n) => (
        <div key={n.id} className="alert warning">
          <span>{n.message}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => session.dismissNotice(n.id)}>
            ×
          </button>
        </div>
      ))}
      {route.name === "list" && <ThreadList session={session} />}
      {route.name === "new" && <NewThread session={session} />}
      {route.name === "thread" && <ThreadView session={session} />}
    </div>
  );
}
