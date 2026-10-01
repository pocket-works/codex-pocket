import { lazy, Suspense, useState } from "react";
import { pairComputer, pairingTargetFromScan } from "../state/auth.js";
import { getComputerRegistry, normalizeOrigin, type Computer, type PairResult } from "../state/computers.js";
import { friendlyError } from "../state/errors.js";

// jsQR is only needed here, so it stays out of the main bundle.
const QrScanner = lazy(() => import("./QrScanner.js").then((m) => ({ default: m.QrScanner })));

// Scanning the QR with the Camera app opens the #pair= link in Safari, but an
// app added to the home screen has its own storage, so it can scan the same
// QR here with its own camera, or take the code typed in.
export function PairScreen({ error, computer, embedded = false, disabled = false, onBusyChange, onPaired, onCancel }: {
  error?: string;
  computer?: Computer;
  embedded?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onPaired?: (origin: string, pair: PairResult) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [address, setAddress] = useState(computer?.origin ?? location.origin);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [failure, setFailure] = useState<string | null>(error ?? null);
  const canScan = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  async function pair(value: string, targetAddress = address) {
    if (!value.trim() || busy || disabled) return;
    setBusy(true);
    onBusyChange?.(true);
    setFailure(null);
    try {
      const origin = normalizeOrigin(targetAddress);
      const result = await pairComputer(origin, value);
      await (onPaired ? onPaired(origin, result) : getComputerRegistry().add(origin, result));
    } catch (err) {
      setFailure(friendlyError(err));
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  function onScan(text: string) {
    setScanning(false);
    const scanned = pairingTargetFromScan(text, address);
    if (scanned) {
      setCode(scanned.code);
      setAddress(scanned.origin);
      void pair(scanned.code, scanned.origin);
    } else setFailure("That QR code is not a Codex Pocket pairing code.");
  }

  return (
    <main className={embedded ? "pair pair-inline" : "screen center pair"}>
      <div className="pair-card">
        {!embedded && <><img className="pair-logo" src="/icon.svg?v=2" alt="" width={72} height={72} /><h1>Codex Pocket</h1><p className="muted pair-sub">Pair this phone with your Mac to control Codex from anywhere.</p></>}

        {canScan && !manual && (
          <button type="button" className="primary pair-scan" onClick={() => setScanning(true)} disabled={busy || disabled}>
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
            <input className="pair-address" type="url" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://mac.tailnet.ts.net" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Computer address" required />
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
            <button className="primary" type="submit" disabled={busy || disabled || !code.trim()}>
              {busy ? "…" : "Pair"}
            </button>
          </form>
        )}
        {canScan && (
          <button type="button" className="link pair-toggle" disabled={busy || disabled} onClick={() => setManual((m) => !m)}>
            {manual ? "Scan QR code instead" : "Enter code instead"}
          </button>
        )}
        {failure && <p className="error pair-error">{failure}</p>}
        {onCancel && <button type="button" className="link" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>

      {!embedded && <p className="muted small pair-hint">
        On your Mac: <code>make pair</code>
      </p>}

      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onResult={onScan} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </main>
  );
}
