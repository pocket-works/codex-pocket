import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import { getToken, pairingCodeFromUrl, redeemPairingCode, setToken, wsUrl } from "./state/auth.js";
import { Session } from "./state/session.js";
import { RpcClient } from "./rpc/client.js";
import { PairScreen } from "./ui/PairScreen.js";
import "./styles.css";

async function boot(): Promise<void> {
  const root = createRoot(document.getElementById("root")!);
  const code = pairingCodeFromUrl();
  if (code) {
    try {
      setToken(await redeemPairingCode(code));
      history.replaceState(null, "", "/#/");
    } catch (err) {
      root.render(<PairScreen error={err instanceof Error ? err.message : String(err)} />);
      return;
    }
  }
  const token = getToken();
  if (!token) {
    root.render(<PairScreen />);
    return;
  }
  const session = new Session(new RpcClient({ url: wsUrl(), token }));
  session.start();
  root.render(
    <StrictMode>
      <App session={session} />
    </StrictMode>,
  );
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

void boot();
