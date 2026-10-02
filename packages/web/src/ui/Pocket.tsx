import { useEffect, useState } from "react";
import type { Computer, ComputerRegistry, PairResult } from "../state/computers.js";
import { HostClient, HostHttpError } from "../state/host-client.js";
import { Session } from "../state/session.js";
import { createStore, useStore } from "../state/store.js";
import { RpcClient } from "../rpc/client.js";
import { enablePush } from "../state/push.js";
import { App } from "./App.js";
import { PairScreen } from "./PairScreen.js";
import { ComputersSheet } from "./ComputersSheet.js";
import { ComputerScreen } from "./ComputerScreen.js";
import { PairingScreen } from "./PairingScreen.js";
import { AboutSheet } from "./AboutSheet.js";
import { ComputerContext } from "./ComputerContext.js";
import { closePocketPanel, computerRouteHash, localRouteHash, openPocketPanel, readPocketPanel, routeComputer, setRouteComputer, workspaceRouteHash } from "./route.js";
import { friendlyError } from "../state/errors.js";

const idle = createStore(0);

export function Pocket({ registry, initialError }: { registry: ComputerRegistry; initialError?: string }) {
  const state = useStore(registry.store, (s) => s);
  const active = state.computers.find((c) => c.id === state.activeId) ?? null;
  const [session, setSession] = useState<Session | null>(null);
  const [panel, setPanel] = useState(() => readPocketPanel(location.hash));
  const pending = useStore(session?.operations ?? idle, (s) => s);
  const [problem, setProblem] = useState<{ message: string; pairing: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [unknown, setUnknown] = useState(false);
  const [pairError, setPairError] = useState(initialError);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const entry = state.computers.find((c) => c.origin === location.origin);
    if (!entry) return;
    const send = () => navigator.serviceWorker.controller?.postMessage({ type: "legacy-computer", id: entry.id, name: entry.name });
    send();
    navigator.serviceWorker.addEventListener("controllerchange", send);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", send);
  }, [state.computers]);

  useEffect(() => {
    const route = () => {
      setPanel(readPocketPanel(location.hash));
      let id = routeComputer(location.hash);
      if (!id && location.hash.startsWith("#/t/")) {
        const entry = registry.store.get().computers.find((c) => c.origin === location.origin);
        if (entry) {
          id = entry.id;
          history.replaceState(null, "", `/${computerRouteHash(id, location.hash)}`);
        }
      }
      if (id && !registry.store.get().computers.some((c) => c.id === id)) { setUnknown(true); return; }
      setUnknown(false);
      if (id && id !== registry.active?.id) registry.select(id);
      if (id && registry.active?.lastRoute !== workspaceRouteHash(location.hash)) registry.update(id, { lastRoute: workspaceRouteHash(location.hash) });
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, [registry]);

  useEffect(() => {
    if (!active || unknown) { setSession(null); return; }
    const requested = routeComputer(location.hash);
    if (requested && requested !== active.id) return;
    const local = !requested && ["", "#", "#/"].includes(location.hash) ? workspaceRouteHash(active.lastRoute) : localRouteHash(location.hash);
    const hash = computerRouteHash(active.id, local);
    setRouteComputer(active.id);
    if (hash !== location.hash) history.replaceState(null, "", `/${hash}`);
    const host = new HostClient(active);
    const next = new Session(new RpcClient({ url: host.wsUrl, token: active.token }), host);
    const offState = next.rpc.onStateChange(() => {
      if (next.rpc.pairingRevoked) setProblem({ message: "Pairing was revoked. Pair this computer again.", pairing: true });
    });
    setSession(next);
    setProblem(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;
    const connect = async () => {
      if (checking || host.disposed) return;
      checking = true;
      try {
        const info = await host.me(true);
        if (host.disposed) return;
        registry.update(active.id, { instanceId: info.instanceId ?? null, deviceId: info.device.id });
        setProblem(null);
        next.start();
        const notifications = registry.store.get().computers.find((c) => c.id === active.id)?.notifications;
        if (notifications || info.device.push) {
          void enablePush(host, false).then((status) => {
            if (!host.disposed && status === "on") registry.update(active.id, { notifications: true });
          }).catch(() => {});
        }
      } catch (err) {
        if (host.disposed) return;
        const pairing = (err instanceof HostHttpError && err.status === 401) || /identity changed/.test(String(err));
        const message = pairing || err instanceof HostHttpError ? friendlyError(err) : `Can't reach ${active.name}. Check this Mac's connection and Tailscale.`;
        setProblem({ message, pairing });
        if (!pairing) {
          timer = setTimeout(() => void connect(), 6000);
        }
      } finally { checking = false; }
    };
    const wake = () => { if (document.visibilityState === "visible") void connect(); };
    void connect();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    (window as unknown as { codexPocket: { session: Session } }).codexPocket = { session: next };
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      offState();
      next.dispose();
      setRouteComputer(null);
    };
  }, [active?.id, active?.origin, active?.token, attempt, unknown, registry]);

  const current = session?.host?.id === active?.id && session?.host?.computer.token === active?.token ? session : null;
  const manage = (id?: string) => openPocketPanel(id ? { name: "computer", id } : { name: "computers" });
  const fullPage = panel?.name === "computer" || panel?.name === "computer-details" || panel?.name === "pair";
  const target = panel && "id" in panel ? state.computers.find((computer) => computer.id === panel.id) : undefined;

  function useComputer(computer: Computer) {
    if (pending) return;
    if (computer.id === active?.id && panel?.name === "computers") { closePocketPanel(); return; }
    registry.select(computer.id);
    history.replaceState(null, "", `/${computerRouteHash(computer.id, workspaceRouteHash(computer.lastRoute))}`);
    window.dispatchEvent(new Event("hashchange"));
  }

  function removeComputer(computer: Computer) {
    registry.remove(computer.id);
    if (computer.id === active?.id) {
      const next = registry.active;
      history.replaceState(null, "", `/${next ? computerRouteHash(next.id, workspaceRouteHash(next.lastRoute)) : "#/"}`);
      window.dispatchEvent(new Event("hashchange"));
    } else openPocketPanel({ name: "computers" }, true);
  }

  async function paired(origin: string, result: PairResult) {
    const previous = target;
    const saved = registry.store.get().computers;
    const added = registry.add(origin, result, previous?.id);
    const existing = saved.find((computer) => computer.id === added.id);
    history.replaceState(null, "", `/${computerRouteHash(added.id, workspaceRouteHash(added.lastRoute))}`);
    window.dispatchEvent(new Event("hashchange"));
    if (existing) {
      const old = new HostClient(existing);
      try { await old.fetch("/api/device", { method: "DELETE" }); } catch {}
      finally { old.dispose(); }
    }
  }
  return (
    <ComputerContext.Provider value={{ registry, active, manage, about: () => openPocketPanel({ name: "about" }) }}>
      <div className="pocket">
        <div className="pocket-workspace" hidden={fullPage}>
        {active && pairError && <div className="computer-problem" role="alert"><span>{pairError}</span><button className="icon-btn" aria-label="Dismiss" onClick={() => setPairError(undefined)}>×</button></div>}
        {unknown ? (
          <main className="screen center"><p>This computer is no longer paired.</p><button className="primary" onClick={() => manage()}>Computers</button></main>
        ) : active ? (
          <>
            {current && <App key={`${active.id}:${attempt}:${active.token}`} session={current} connectionProblem={problem?.message} onRetry={() => setAttempt((n) => n + 1)} onComputers={() => manage()} onPairAgain={problem?.pairing ? () => openPocketPanel({ name: "pair", id: active.id }) : undefined} />}
          </>
        ) : (
          <PairScreen error={initialError} onPaired={(origin, pair) => {
            const computer = registry.add(origin, pair);
            location.hash = computerRouteHash(computer.id, computer.lastRoute);
          }} />
        )}
        </div>
        {panel?.name === "computers" && <ComputersSheet registry={registry} session={current} onChoose={useComputer} onDetails={(id) => manage(id)} onAdd={() => openPocketPanel({ name: "pair" })} onClose={closePocketPanel} />}
        {(panel?.name === "computer" || panel?.name === "computer-details") && target && <ComputerScreen key={`${target.id}:${target.token}`} computer={target} registry={registry} session={current} showPairingDetails={panel.name === "computer-details"} onBack={() => {
          if (panel.name === "computer-details" && !history.state?.pocketPanel) openPocketPanel({ name: "computer", id: target.id }, true);
          else closePocketPanel();
        }} onUse={useComputer} onDetails={() => openPocketPanel({ name: "computer-details", id: target.id })} onPair={() => openPocketPanel({ name: "pair", id: target.id })} onRemove={removeComputer} />}
        {fullPage && panel && "id" in panel && panel.id && !target && <main className="screen computer-screen"><header className="topbar"><button className="icon-btn" aria-label="Back" onClick={closePocketPanel}>‹</button><h1>Computer</h1></header><p className="muted center">This computer is no longer paired.</p><button onClick={() => openPocketPanel({ name: "computers" }, true)}>Computers</button></main>}
        {panel?.name === "pair" && (!panel.id || target) && <PairingScreen key={target?.id ?? "new"} computer={target} pending={pending > 0} onBack={closePocketPanel} onPaired={paired} />}
        {panel?.name === "about" && <AboutSheet onClose={closePocketPanel} />}
      </div>
    </ComputerContext.Provider>
  );
}
