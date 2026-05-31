// NEIRO 音色 — service worker.
// P4: tuned for first paint. Pre-cache the shell so a returning visitor
// sees the skeleton + chrome instantly; stale-while-revalidate the
// catalogue so it loads from cache and refreshes in the background.
// Audio files are never cached — they stream on demand.
const VERSION = "neiro-v6";
const SHELL = [
  "./",
  "index.html",
  "neiro.css",
  "neiro.js",
  "neiro-data.js",
  "boot.js",
  "tabler.css",
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
const CATALOGUE = /\/_catalogue\//;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Audio never gets cached — straight to network so range requests work.
  if (AUDIO.test(url.pathname)) return;

  // Catalogue.json: stale-while-revalidate. Cached copy returns instantly,
  // network refreshes the cache in the background for the next load.
  if (CATALOGUE.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Navigations: network-first so deploys go live; fall back to shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(new URL("index.html", self.location).toString()))
    );
    return;
  }

  // Static assets: cache-first, then network (and update cache).
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
