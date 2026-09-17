import { useEffect, useState } from "react";
import { Session } from "../state/session.js";
import { useStore } from "../state/store.js";

// Model + reasoning effort for the *next* turn. Shown as a compact label;
// tapping opens a sheet with the catalog from `model/list`.
export function ModelPicker({ session }: { session: Session }) {
  const open = useStore(session.store, (s) => s.open);
  const models = useStore(session.store, (s) => s.models);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    if (sheet) void session.loadModels().catch(() => {});
  }, [sheet, session]);

  if (!open) return null;
  const effective = Session.effectiveModel(open);
  const current = models.find((m) => m.model === effective.model);
  const label = `${current?.displayName ?? (effective.model || "model")}${effective.effort ? ` · ${effective.effort}` : ""}`;

  return (
    <>
      <button className="subtle" onClick={() => setSheet(true)}>
        {label}
      </button>
      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Model for next turn</h2>
            {models.length === 0 && <p className="muted">Loading models…</p>}
            <ul className="model-list">
              {models.map((m) => (
                <li key={m.id}>
                  <div className="model-name">{m.displayName}</div>
                  <div className="effort-row">
                    {m.supportedReasoningEfforts.map((e) => {
                      const active = m.model === effective.model && e.reasoningEffort === effective.effort;
                      return (
                        <button
                          key={e.reasoningEffort}
                          className={active ? "chip active" : "chip"}
                          onClick={() => {
                            session.setModel(m.model, e.reasoningEffort);
                            setSheet(false);
                          }}
                        >
                          {e.reasoningEffort}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
