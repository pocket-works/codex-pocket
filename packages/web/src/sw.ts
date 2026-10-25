export {};

declare const __SHELL_ASSETS__: string[];
declare const __SHELL_VERSION__: string;

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE_PREFIX = "codex-pocket-shell-";
const CACHE = `${CACHE_PREFIX}${__SHELL_VERSION__}`;
const METADATA = "codex-pocket-metadata";
const LEGACY_COMPUTER = "/__pocket-legacy-computer";
const SHELL_NETWORK_TIMEOUT_MS = 3000;

worker.addEventListener("install", (event) => {
  // Install HTML and every bundle together, before taking over any page.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(__SHELL_ASSETS__)).then(() => worker.skipWaiting()));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener("message", (event) => {
  if (event.data?.type !== "legacy-computer" || typeof event.data.id !== "string") return;
  event.waitUntil(caches.open(METADATA).then((cache) => cache.put(LEGACY_COMPUTER, new Response(JSON.stringify({ id: event.data.id, name: event.data.name })))));
});

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== worker.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/ws" || (request.cache === "no-store" && request.mode !== "navigate")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetchWithTimeout(request, SHELL_NETWORK_TIMEOUT_MS)
        .catch(async () => {
          const cache = await caches.open(CACHE);
          const shell = await cache.match("/");
          if (!shell) throw new Error("App shell is not cached");
          return shell;
        }),
    );
    return;
  }

  // Never return HTML for a missing script, stylesheet, or API response.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok && url.pathname.startsWith("/assets/")) {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  })());
});

async function fetchWithTimeout(request: Request, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const response = await fetch(request, { signal: ctrl.signal });
    if (!response.ok) throw new Error(`Host unavailable (HTTP ${response.status})`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// Web Push from the host: {title, body, threadId, tag}.
worker.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; threadId?: string; tag?: string } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const threadId = data.threadId || null;
  event.waitUntil(caches.open(METADATA).then((cache) => cache.match(LEGACY_COMPUTER)).then(async (response) => {
    const computer = response ? await response.json() : null;
    return worker.registration.showNotification(data.title || "Codex", {
      body: data.body || "",
      tag: data.tag || threadId || undefined,
      icon: "/icon-180.png?v=2",
      badge: "/icon-180.png?v=2",
      data: { threadId, computerId: computer?.id ?? null },
    });
  }));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const threadId = event.notification.data && event.notification.data.threadId;
  const computerId = event.notification.data && event.notification.data.computerId;
  const base = computerId ? `/#/h/${encodeURIComponent(computerId)}` : "/#";
  const url = new URL(threadId ? `${base}/t/${encodeURIComponent(threadId)}` : `${base}/`, worker.location.origin).href;
  event.waitUntil((async () => {
    await caches.open(METADATA).then((cache) => cache.put("/__pocket-notification-route", new Response(JSON.stringify({ url, clickedAt: Date.now() })))).catch(() => {});
    const list = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = list.find((c) => new URL(c.url).origin === worker.location.origin);
    if (client) {
      const target = await client.navigate(url).catch(() => null) ?? client;
      target.postMessage({ type: "notification-open" });
      await target.focus().catch(() => worker.clients.openWindow(url));
    } else await worker.clients.openWindow(url);
  })());
});
