// HIBIKI 響 — service worker.
// Caches the app shell for offline browsing.
// Audio files are never cached — they stream on demand (spec §F4).
const VERSION = "hibiki-v2";
const SHELL = [
  "./",
  "index.html",
  "hibiki.css",
  "hibiki.js",
  "hibiki-data.js",
  "manifest.json",
  "icon.svg",
].map((p) => new URL(p, self.location).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.allSettled(SHELL.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const AUDIO = /\.(flac|mp3|m4a|aac|wav|ogg)$/i;
const NEVER_CACHE = /\/_catalogue\//;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache audio or catalogue — always fetch from network.
  if (AUDIO.test(url.pathname) || NEVER_CACHE.test(url.pathname)) return;

  // Navigations: network-first, fall back to shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(new URL("index.html", self.location).toString()))
    );
    return;
  }

  // Static assets: cache-first, then network (cache same-origin).
  event.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit)
    )
  );
});
