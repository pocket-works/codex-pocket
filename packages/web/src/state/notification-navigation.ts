const METADATA = "codex-pocket-metadata";
const PENDING_ROUTE = "/__pocket-notification-route";
let restoring = Promise.resolve();

/** Recover a notification destination even when the browser only wakes the PWA. */
export function restoreNotificationRoute(): Promise<void> {
  restoring = restoring.then(async () => {
    if (!("caches" in globalThis)) return;
    const cache = await caches.open(METADATA);
    const response = await cache.match(PENDING_ROUTE);
    if (!response) return;
    await cache.delete(PENDING_ROUTE);
    const { url, clickedAt } = await response.json() as { url: string; clickedAt: number };
    const target = new URL(url);
    if (target.origin !== location.origin || target.pathname !== "/" || !/^#\/(?:h\/[^/?]+\/|t\/)/.test(target.hash)) return;
    if (!Number.isFinite(clickedAt) || Date.now() - clickedAt > 5 * 60_000) return;
    if (location.hash === target.hash) return;
    history.replaceState(null, "", target.href);
    window.dispatchEvent(new Event("hashchange"));
  }).catch(() => {});
  return restoring;
}

export function listenForNotificationNavigation(): () => void {
  const wake = () => { if (document.visibilityState === "visible") void restoreNotificationRoute(); };
  const message = (event: MessageEvent) => { if (event.data?.type === "notification-open") void restoreNotificationRoute(); };
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  navigator.serviceWorker?.addEventListener("message", message);
  return () => {
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", wake);
    navigator.serviceWorker?.removeEventListener("message", message);
  };
}
