import { lazy, Suspense, useState } from "react";
import { pairingCodeFromScan, redeemPairingCode, setToken } from "../state/auth.js";

// jsQR is only needed here, so it stays out of the main bundle.
const QrScanner = lazy(() => import("./QrScanner.js").then((m) => ({ default: m.QrScanner })));

// Scanning the QR with the Camera app opens the #pair= link in Safari, but an
// app added to the home screen has its own storage, so it can scan the same
// QR here with its own camera, or take the code typed in.
export function PairScreen({ error }: { error?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [failure, setFailure] = useState<string | null>(error ?? null);
  const canScan = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  async function pair(value: string) {
    if (!value.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      setToken(await redeemPairingCode(value));
      location.replace("/#/");
      location.reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function onScan(text: string) {
    setScanning(false);
    const scanned = pairingCodeFromScan(text);
    if (scanned) {
      setCode(scanned);
      void pair(scanned);
    } else setFailure("That QR code is not a Codex Pocket pairing code.");
  }

  return (
    <main className="screen center pair">
      <div className="pair-card">
        <img className="pair-logo" src="/icon.svg?v=2" alt="" width={72} height={72} />
        <h1>Codex Pocket</h1>
        <p className="muted pair-sub">Pair this phone with your Mac to control Codex from anywhere.</p>

        {canScan && !manual && (
          <button type="button" className="primary pair-scan" onClick={() => setScanning(true)} disabled={busy}>
            Scan QR code
          </button>
        )}
        {(manual || !canScan) && (
          <form
            className="pair-form"
            onSubmit={(e) => {
              e.preventDefault();
              void pair(code);
            }}
          >
            <input
              className="pair-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-EFGH"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus={manual}
              aria-label="Pairing code"
            />
            <button className="primary" type="submit" disabled={busy || !code.trim()}>
              {busy ? "…" : "Pair"}
            </button>
          </form>
        )}
        {canScan && (
          <button type="button" className="link pair-toggle" onClick={() => setManual((m) => !m)}>
            {manual ? "Scan QR code instead" : "Enter code instead"}
          </button>
        )}
        {failure && <p className="error pair-error">{failure}</p>}
      </div>

      <p className="muted small pair-hint">
        On your Mac: <code>make pair</code>
      </p>

      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onResult={onScan} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </main>
  );
}
