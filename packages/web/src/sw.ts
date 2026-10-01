export {};

declare const __SHELL_ASSETS__: string[];
declare const __SHELL_VERSION__: string;

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE_PREFIX = "codex-pocket-shell-";
const CACHE = `${CACHE_PREFIX}${__SHELL_VERSION__}`;
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
  event.waitUntil(worker.registration.showNotification(data.title || "Codex", {
    body: data.body || "",
    tag: data.tag || threadId || undefined,
    icon: "/icon-180.png?v=2",
    badge: "/icon-180.png?v=2",
    data: { threadId },
  }));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const threadId = event.notification.data && event.notification.data.threadId;
  const url = threadId ? `/#/t/${encodeURIComponent(threadId)}` : "/";
  event.waitUntil(worker.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const client = list[0];
    if (client) {
      void client.navigate(url).catch(() => {});
      return client.focus();
    }
    return worker.clients.openWindow(url);
  }));
});
