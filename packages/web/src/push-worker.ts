/// <reference lib="webworker" />

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
export {};
const params = new URL(worker.location.href).searchParams;
const computerId = params.get("computer") ?? "";
const computerName = params.get("name") ?? "Computer";

worker.addEventListener("install", (event) => event.waitUntil(worker.skipWaiting()));

worker.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; threadId?: string } = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  const threadId = typeof data.threadId === "string" ? data.threadId : null;
  event.waitUntil(worker.registration.showNotification(`${computerName} · ${data.title || "Codex"}`, {
    body: data.body || "", tag: `${computerId}:${threadId ?? "event"}`,
    icon: "/icon-180.png?v=2", badge: "/icon-180.png?v=2", data: { computerId, threadId },
  }));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const threadId = event.notification.data?.threadId;
  const route = `/#/h/${encodeURIComponent(computerId)}${threadId ? `/t/${encodeURIComponent(threadId)}` : "/"}`;
  const url = new URL(route, worker.location.origin).href;
  event.waitUntil((async () => {
    // iOS may wake the installed app without applying the requested fragment.
    await caches.open("codex-pocket-metadata").then((cache) => cache.put("/__pocket-notification-route", new Response(JSON.stringify({ url, clickedAt: Date.now() })))).catch(() => {});
    const clients = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = clients.find((c) => new URL(c.url).origin === worker.location.origin);
    if (client) {
      const target = await client.navigate(url).catch(() => null) ?? client;
      target.postMessage({ type: "notification-open" });
      await target.focus().catch(() => worker.clients.openWindow(url));
    } else await worker.clients.openWindow(url);
  })());
});
