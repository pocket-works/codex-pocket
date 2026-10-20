import { useEffect, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import type { Session } from "../state/session.js";
import { friendlyError } from "../state/errors.js";
import { useDialog } from "./dialog.js";
import { XIcon } from "./icons.js";
import { prepareVisualization } from "./visualization.js";
import { visualizationImageLoader } from "./visualization-images.js";

export function VisualizationPreview({ path, session, onClose }: { path: string; session: Session; onClose: () => void }) {
  const name = path.split("/").pop() || "Visualization";
  const dialog = useDialog(name, onClose);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let live = true;
    setSource(null);
    setError(null);
    const readImage = visualizationImageLoader(path, (imagePath) => live ? session.readImageFile(imagePath) : Promise.resolve(null));
    const onMessage = (event: MessageEvent) => {
      const request = event.data;
      if (!live || !frame.current?.contentWindow || event.source !== frame.current.contentWindow || event.origin !== "null"
        || !request || request.type !== "pocket/visualization/image" || typeof request.id !== "string" || request.id.length > 100) return;
      const sender = event.source as Window;
      void readImage(request.url).then((data) => {
        if (live && frame.current?.contentWindow === sender) sender.postMessage({ type: "pocket/visualization/image-result", id: request.id, data }, "*");
      });
    };
    window.addEventListener("message", onMessage);
    void session.readTextFile(path).then((text) => {
      if (!live) return;
      if (text === null) throw new Error("This visualization is not an HTML text file.");
      const document = prepareVisualization(text, path);
      if (live) setSource(document);
    }).catch((err: unknown) => { if (live) setError(friendlyError(err)); });
    return () => { live = false; window.removeEventListener("message", onMessage); };
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
          : <iframe ref={frame} className="visualization-frame" title={name} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" srcDoc={source} />}
    </section>
  </div>, document.body);
}
