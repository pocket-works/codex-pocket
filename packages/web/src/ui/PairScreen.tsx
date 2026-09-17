export function PairScreen({ error }: { error?: string }) {
  return (
    <main className="screen center">
      <h1>Codex Pocket</h1>
      {error ? <p className="error">{error}</p> : <p>This phone is not paired yet.</p>}
      <p className="muted">
        On your Mac run <code>codex-pocket pair</code> and scan the QR code with your camera.
      </p>
    </main>
  );
}
