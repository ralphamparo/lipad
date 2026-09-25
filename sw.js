// Lipad service worker: keeps the app shell installable and shows an offline notice.
// Fares are never cached — they go stale in minutes and the server already caches them.
const VERSION = "lipad-v2";
const SHELL = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // always live

  // Shell files: always try the network first, so a deploy reaches people immediately;
  // the cache is the offline fallback, refreshed on every successful fetch.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
  );
});
