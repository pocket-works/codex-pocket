import { useEffect, useState } from "react";
import type { Session } from "../state/session.js";
import { useStore } from "../state/store.js";
import { navigate } from "./route.js";

export function NewThread({ session }: { session: Session }) {
  const threads = useStore(session.store, (s) => s.threads);
  const models = useStore(session.store, (s) => s.models);
  const connection = useStore(session.store, (s) => s.connection);
  const cwds = session.knownCwds();
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connection !== "open") return;
    if (threads.length === 0) void session.loadThreads();
    void session.loadModels().catch(() => {});
  }, [connection, session, threads.length]);

  useEffect(() => {
    if (!cwd && cwds.length > 0) setCwd(cwds[0]);
  }, [cwds, cwd]);

  async function create() {
    if (!cwd) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = models.find((m) => m.id === model);
      const id = await session.startThread(cwd, chosen ? chosen.model : null, chosen ? chosen.defaultReasoningEffort : null);
      navigate({ name: "thread", id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate({ name: "list" })}>
          ‹
        </button>
        <h1>New thread</h1>
      </header>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          Project folder
          <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
            {cwds.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Codex default</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={!cwd || busy}>
          {busy ? "Starting…" : "Start"}
        </button>
      </form>
    </main>
  );
}
