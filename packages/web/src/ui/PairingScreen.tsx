import { useState } from "react";
import type { Computer, PairResult } from "../state/computers.js";
import { useDialog } from "./dialog.js";
import { useSwipeBack } from "./gestures.js";
import { PairScreen } from "./PairScreen.js";

export function PairingScreen({ computer, pending, onBack, onPaired }: { computer?: Computer; pending: boolean; onBack: () => void; onPaired: (origin: string, result: PairResult) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) onBack(); };
  const title = computer ? "Pair again" : "Add computer";
  const dialog = useDialog(title, close);
  const back = useSwipeBack(close);
  return <div className={`screen computer-screen ${back.dragging ? "dragging" : ""}`} ref={dialog.ref} {...dialog.props} style={back.style} {...back.handlers}>
    <header className="topbar"><button className="icon-btn" aria-label="Back" title="Back" disabled={busy} onClick={close}>‹</button><div className="topbar-title"><h1>{title}</h1>{computer && <div className="muted small">{computer.name}</div>}</div></header>
    <div className="computer-content pairing-content">
      {pending && <p className="muted small" role="status">Finishing a send or upload…</p>}
      <PairScreen computer={computer} embedded disabled={pending} onBusyChange={setBusy} onPaired={onPaired} />
    </div>
  </div>;
}
