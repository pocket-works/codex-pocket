import { useEffect } from "react";
import { Session } from "../state/session.js";
import { useStore } from "../state/store.js";

// Bottom sheet for the next turn's model and reasoning effort, laid out like
// the official app: a Model row, and an "Intelligence" slider whose stops are
// the efforts the chosen model supports.
export function ModelSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const open = useStore(session.store, (s) => s.open);
  const models = useStore(session.store, (s) => s.models);

  useEffect(() => {
    void session.loadModels().catch(() => {});
  }, [session]);

  if (!open) return null;
  const effective = Session.effectiveModel(open);
  const current = models.find((m) => m.model === effective.model) ?? null;
  const efforts = current?.supportedReasoningEfforts.map((e) => e.reasoningEffort) ?? [];
  const effortIndex = Math.max(0, efforts.indexOf(effective.effort ?? ""));
  const effortLabel = effective.effort ? capitalize(effective.effort) : "Default";

  function pickModel(model: string) {
    const m = models.find((x) => x.model === model);
    if (!m) return;
    const keep = m.supportedReasoningEfforts.some((e) => e.reasoningEffort === effective.effort);
    session.setModel(m.model, keep ? effective.effort : m.defaultReasoningEffort);
  }

  function pickEffort(index: number) {
    if (!current) return;
    session.setModel(current.model, efforts[index] ?? null);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet model-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2>
          {current?.displayName ?? (effective.model || "Model")} <span className="muted">{effortLabel}</span>
        </h2>

        <div className="setting-group">
          <label className="setting-row">
            <span>Model</span>
            <span className="setting-value">
              <select value={current?.model ?? ""} onChange={(e) => pickModel(e.target.value)} disabled={models.length === 0}>
                {models.length === 0 && <option value="">Loading…</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.model}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <span className="chevrons" aria-hidden>
                ⌃⌄
              </span>
            </span>
          </label>
          <div className="setting-row">
            <span>Intelligence</span>
            <span className="setting-value">{effortLabel}</span>
          </div>
        </div>

        {efforts.length > 1 && (
          <div className="effort-slider" style={{ ["--stops" as string]: efforts.length, ["--index" as string]: effortIndex }}>
            <input
              type="range"
              min={0}
              max={efforts.length - 1}
              step={1}
              value={effortIndex}
              aria-label="Intelligence"
              onChange={(e) => pickEffort(Number(e.target.value))}
            />
            <div className="effort-track" aria-hidden>
              <div className="effort-fill" />
              {efforts.map((e, i) => (
                <span key={e} className={`effort-dot ${i <= effortIndex ? "on" : ""}`} />
              ))}
              <div className="effort-knob" />
            </div>
            <div className="effort-labels" aria-hidden>
              {efforts.map((e) => (
                <span key={e}>{capitalize(e)}</span>
              ))}
            </div>
          </div>
        )}
        {current?.supportedReasoningEfforts[effortIndex]?.description && (
          <p className="muted small center">{current.supportedReasoningEfforts[effortIndex].description}</p>
        )}
        {open.override && <p className="muted small center">Applies to your next message.</p>}
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
