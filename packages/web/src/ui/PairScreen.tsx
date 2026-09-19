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
    <main className="screen center">
      <h1>Codex Pocket</h1>
      {failure ? <p className="error">{failure}</p> : <p>This phone is not paired yet.</p>}
      <p className="muted">
        On your Mac run <code>codex-pocket pair</code>, then scan the QR code or type the code it prints:
      </p>
      {canScan && (
        <button type="button" className="primary pair-scan" onClick={() => setScanning(true)} disabled={busy}>
          Scan QR code
        </button>
      )}
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
          inputMode="text"
          aria-label="Pairing code"
        />
        <button type="submit" disabled={busy || !code.trim()}>
          {busy ? "Pairing…" : "Pair"}
        </button>
      </form>
      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onResult={onScan} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </main>
  );
}
