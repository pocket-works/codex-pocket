import { createRoot } from "react-dom/client";
import { pairComputer, pairingCodeFromUrl } from "./state/auth.js";
import { getComputerRegistry } from "./state/computers.js";
import { Pocket } from "./ui/Pocket.js";
import { installKeyboardFix } from "./ui/keyboard-fix.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

async function boot(): Promise<void> {
  installKeyboardFix();
  const registry = getComputerRegistry();
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register("/sw.js").then(async (reg) => {
      const entry = registry.store.get().computers.find((c) => c.origin === location.origin);
      const worker = reg.active ?? (await navigator.serviceWorker.ready).active;
      if (entry) worker?.postMessage({ type: "legacy-computer", id: entry.id, name: entry.name });
    }).catch(() => {});
  }
  const code = pairingCodeFromUrl();
  let initialError: string | undefined;
  if (code) {
    root.render(
      <div className="app">
        <main className="screen center">
          <h1>Codex Pocket</h1>
          <p role="status">Pairing with your Mac...</p>
        </main>
      </div>,
    );
    history.replaceState(null, "", "/#/");
    try {
      registry.add(location.origin, await pairComputer(location.origin, code));
    } catch (err) {
      initialError = err instanceof Error ? err.message : String(err);
    }
  }
  root.render(<Pocket registry={registry} initialError={initialError} />);
}

void boot().catch((err) => {
  root.render(<main className="screen center"><p role="alert">{err instanceof Error ? err.message : String(err)}</p><button onClick={() => location.reload()}>Retry</button></main>);
});
