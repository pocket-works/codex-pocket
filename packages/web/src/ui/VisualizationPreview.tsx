import { useEffect, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import type { Session } from "../state/session.js";
import { friendlyError } from "../state/errors.js";
import { useDialog } from "./dialog.js";
import { XIcon } from "./icons.js";
import { visualizationDocument } from "./visualization.js";

export function VisualizationPreview({ path, session, onClose }: { path: string; session: Session; onClose: () => void }) {
  const name = path.split("/").pop() || "Visualization";
  const dialog = useDialog(name, onClose);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSource(null);
    setError(null);
    void session.readTextFile(path).then((text) => {
      if (!live) return;
      if (text === null) throw new Error("This visualization is not an HTML text file.");
      setSource(visualizationDocument(text));
    }).catch((err: unknown) => { if (live) setError(friendlyError(err)); });
    return () => { live = false; };
  }, [path, session, attempt]);
  const stopTouch = (event: TouchEvent) => event.stopPropagation();
  return createPortal(<div className="pdf-viewer-backdrop" onTouchStart={stopTouch} onTouchMove={stopTouch} onTouchEnd={stopTouch} onTouchCancel={stopTouch}>
    <section ref={dialog.ref} {...dialog.props} className="pdf-viewer visualization-viewer">
      <header className="pdf-viewer-header">
        <strong title={path}>{name}</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close visualization"><XIcon /></button>
      </header>
      <p className="visualization-note">Preview only. Codex follow-up actions are unavailable here.</p>
      {error ? <div className="visualization-status" role="alert">{error} <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>
        : source === null ? <p className="visualization-status" role="status">Loading visualization…</p>
          : <iframe className="visualization-frame" title={name} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" srcDoc={source} />}
    </section>
  </div>, document.body);
}
