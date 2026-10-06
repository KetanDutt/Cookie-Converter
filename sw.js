/**
 * Gemini Cookie Converter — service worker.
 *
 * Strategy: **network-first, cache-fallback**.
 *   • Online  → every request goes to the network, so a deployed update is
 *     picked up immediately (no stale-asset surprises).
 *   • Offline → the last successful response is served from the cache, so the
 *     converter keeps working on a plane, in a Faraday cage, or with the
 *     network deliberately disabled (which is rather the point of a tool
 *     that never sends your cookies anywhere).
 *
 * Nothing here ever touches request bodies or cookie values: only the static
 * application files are cached.
 */

const VERSION = '2.3.0';
const CACHE = 'gcc-static-' + VERSION;

/** Files precached on install so the very first offline load works. */
const PRECACHE = [
  './',
  './index.html',
  './404.html',
  './site.webmanifest',
  './assets/style.css',
  './assets/app.js',
  './assets/ui.js',
  './assets/converter.js',
  './assets/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => undefined) // a missing optional file must not break install
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never proxy anything else

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
