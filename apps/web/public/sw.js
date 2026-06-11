// Service worker: PWA installability + app-shell caching.
//
// Freshness contract (docs/adr/0008): the app must auto-update on every deploy.
// Caching is therefore limited to what can never go stale:
//   - /_next/static/* is content-hashed and immutable → cache-first is always safe.
//     A deploy produces new URLs, referenced by the freshly-fetched HTML.
//   - Navigations (HTML) are network-FIRST: online users always get the newest
//     deploy; the cached copy is only a fallback when the network fails, so the
//     installed PWA still launches on bad/no internet instead of a white screen.
//   - Everything else (API calls, next-auth, RSC payloads, SSE streams) is never
//     intercepted — straight to the network, always fresh.
const CACHE_VERSION = 'forkai-shell-v1';

const STATIC_DEST = ['style', 'script', 'font', 'image'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin (the NestJS API, Google Fonts CSS, Cognito…) — never intercept.
  if (url.origin !== self.location.origin) return;

  // Immutable build assets: cache-first. Hashed filenames make staleness impossible.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then((hit) =>
          hit ?? fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }),
        ),
      ),
    );
    return;
  }

  // App shell HTML: network-first so deploys ship instantly; cached copy is the
  // offline/bad-network fallback only.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { cacheName: CACHE_VERSION }).then((hit) => hit ?? caches.match('/', { cacheName: CACHE_VERSION }))),
    );
    return;
  }

  // Public static files (icons, fonts, images): stale-while-revalidate — serve the
  // cached copy instantly, refresh it in the background for next launch.
  if (STATIC_DEST.includes(req.destination)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then((hit) => {
          const refetch = fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          });
          if (hit) {
            refetch.catch(() => {}); // background refresh; offline failure is fine
            return hit;
          }
          return refetch;
        }),
      ),
    );
  }
  // Anything else (RSC payloads, /api/auth, manifest) falls through to the network.
});
