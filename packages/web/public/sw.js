// App-shell cache: the PWA opens instantly even before the host answers.
// API and WebSocket traffic never goes through here.
const CACHE = "codex-pocket-shell-v3";
const METADATA = "codex-pocket-metadata";
const LEGACY_COMPUTER = "/__pocket-legacy-computer";

// When the phone's Tailscale is off, a request to the host does not fail: the
// ts.net name still resolves to a 100.x address, and the connect just hangs
// until the OS gives up, a minute or more on iOS. Meanwhile the PWA sits on a
// white screen. Give the network this long to answer for the shell, then open
// from cache; a deploy still shows up on the next open once the Mac is back.
const SHELL_NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(fetch("/shell-assets.json", { cache: "no-store" }).then((r) => r.json()).then((assets) =>
    caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg?v=2", "/icon-180.png?v=2", ...assets])),
  ).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("codex-pocket-shell-") && k !== CACHE).slice(0, -1).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname === "/ws") return;
  // Hashed assets: cache first. HTML: network first so deploys show up.
  const isAsset = url.pathname.startsWith("/assets/");
  event.respondWith(
    isAsset
      ? caches.match(event.request).then((hit) => hit ?? fetch(event.request).then((res) => cachePut(event.request, res)))
      : fetchWithTimeout(event.request, SHELL_NETWORK_TIMEOUT_MS)
          .then((res) => cachePut(event.request, res))
          .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("/"))),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "legacy-computer" || typeof event.data.id !== "string") return;
  event.waitUntil(caches.open(METADATA).then((cache) => cache.put(LEGACY_COMPUTER, new Response(JSON.stringify({ id: event.data.id, name: event.data.name })))));
});

function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function cachePut(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return response;
}

// Web Push from the host: {title, body, threadId, tag}. Tapping opens (or
// focuses) the app on that thread.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const threadId = data.threadId || null;
  event.waitUntil(caches.open(METADATA).then((cache) => cache.match(LEGACY_COMPUTER)).then(async (response) => {
    const computer = response ? await response.json() : null;
    return self.registration.showNotification(data.title || "Codex", {
      body: data.body || "",
      tag: data.tag || threadId || undefined,
      icon: "/icon-180.png?v=2",
      badge: "/icon-180.png?v=2",
      data: { threadId, computerId: computer?.id ?? null },
    });
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const threadId = event.notification.data && event.notification.data.threadId;
  const computerId = event.notification.data && event.notification.data.computerId;
  const base = computerId ? `/#/h/${encodeURIComponent(computerId)}` : "/#";
  const url = threadId ? `${base}/t/${encodeURIComponent(threadId)}` : `${base}/`;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const client = list[0];
      if (client) {
        client.navigate(url).catch(() => {});
        return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
