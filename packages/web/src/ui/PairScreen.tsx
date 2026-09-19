import { useState } from "react";
import { redeemPairingCode, setToken } from "../state/auth.js";

// Scanning the QR opens the #pair= link in Safari, but an app added to the
// home screen has its own storage, so the code can also be typed here.
export function PairScreen({ error }: { error?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(error ?? null);

  async function pair() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      setToken(await redeemPairingCode(code));
      location.replace("/#/");
      location.reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="screen center">
      <h1>Codex Pocket</h1>
      {failure ? <p className="error">{failure}</p> : <p>This phone is not paired yet.</p>}
      <p className="muted">
        On your Mac run <code>codex-pocket pair</code>, then scan the QR code or type the code it prints:
      </p>
      <form
        className="pair-form"
        onSubmit={(e) => {
          e.preventDefault();
          void pair();
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
        <button className="primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? "Pairing…" : "Pair"}
        </button>
      </form>
    </main>
  );
}
