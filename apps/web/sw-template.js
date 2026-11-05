/* LADDER IDE service worker (generated at build time by vite.config.ts). */
const VERSION = '__VERSION__';
const PRECACHE = __FILES__;
const CACHE = `ladder-ide-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('ladder-ide-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // The API is never cached: shared links must reflect expiration and reports.
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Network first, so updates arrive; offline, any route (/s/:id included) gets the app shell.
    event.respondWith(fetch(req).catch(() => caches.match('/index.html', { cacheName: CACHE })));
    return;
  }
  // Hashed build assets: cache first.
  event.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
});
