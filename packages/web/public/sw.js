// App-shell cache: the PWA opens instantly even before the host answers.
// API and WebSocket traffic never goes through here.
const CACHE = "codex-pocket-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname === "/ws") return;
  // Hashed assets: cache first. HTML: network first so deploys show up.
  const isAsset = url.pathname.startsWith("/assets/");
  event.respondWith(
    isAsset
      ? caches.match(event.request).then((hit) => hit ?? fetch(event.request).then((res) => cachePut(event.request, res)))
      : fetch(event.request)
          .then((res) => cachePut(event.request, res))
          .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("/"))),
  );
});

function cachePut(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return response;
}
