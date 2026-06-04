// Minimal service worker — exists ONLY to satisfy the PWA installability
// criterion: Android/Chrome won't fire `beforeinstallprompt` unless a service
// worker with a fetch handler is registered. It deliberately caches nothing —
// every request passes straight to the network — so the app stays always-fresh
// on each deploy (the remote-webview freshness contract, see docs/adr/0008).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// A registered (even no-op) fetch handler is what the install heuristic checks for.
self.addEventListener('fetch', () => {});
