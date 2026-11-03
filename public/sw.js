// LUMEN SERVICE WORKER (Progressive Web App support)
const CACHE_NAME = 'lumen-cache-v1';

// Auto self-destruct if accidentally executed inside native Capacitor or localhost
if (typeof self !== 'undefined' && self.location && (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1')) {
  self.addEventListener('install', function() {
    if (typeof self.skipWaiting === 'function') self.skipWaiting();
  });
  self.addEventListener('activate', function(event) {
    if (self.registration && typeof self.registration.unregister === 'function') {
      event.waitUntil(
        self.registration.unregister().then(function() {
          if (self.clients && typeof self.clients.matchAll === 'function') {
            return self.clients.matchAll();
          }
          return [];
        }).then(function(clients) {
          for (var i = 0; i < clients.length; i++) {
            if (clients[i] && typeof clients[i].navigate === 'function') {
              clients[i].navigate(clients[i].url);
            }
          }
        })
      );
    }
  });
}

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Let audio streams and API calls bypass service worker cache
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('saavncdn.com') ||
    url.hostname.includes('akamai') ||
    url.hostname.includes('apple.com') ||
    url.hostname.includes('spotify.com')
  ) {
    return;
  }

  // Cache-first for static icons/assets, network fallback
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => response);
    })
  );
});
