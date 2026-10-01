import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import { getToken, pairingCodeFromUrl, redeemPairingCode, setToken, wsUrl } from "./state/auth.js";
import { Session } from "./state/session.js";
import { RpcClient } from "./rpc/client.js";
import { PairScreen } from "./ui/PairScreen.js";
import { installKeyboardFix } from "./ui/keyboard-fix.js";
import "./styles.css";

async function boot(): Promise<void> {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  installKeyboardFix();
  const root = createRoot(document.getElementById("root")!);
  const code = pairingCodeFromUrl();
  if (code) {
    root.render(
      <div className="app">
        <main className="screen center">
          <h1>Codex Pocket</h1>
          <p role="status">Pairing with your Mac...</p>
        </main>
      </div>,
    );
    try {
      setToken(await redeemPairingCode(code));
      history.replaceState(null, "", "/#/");
    } catch (err) {
      root.render(
        <div className="app">
          <PairScreen error={err instanceof Error ? err.message : String(err)} />
        </div>,
      );
      return;
    }
  }
  const token = getToken();
  if (!token) {
    root.render(
      <div className="app">
        <PairScreen />
      </div>,
    );
    return;
  }
  const session = new Session(new RpcClient({ url: wsUrl(), token }));
  session.start();
  // For poking at the app from the browser console (it holds nothing the
  // page does not already have).
  (window as unknown as { codexPocket: { session: Session } }).codexPocket = { session };
  root.render(
    <StrictMode>
      <App session={session} />
    </StrictMode>,
  );
}

void boot();
