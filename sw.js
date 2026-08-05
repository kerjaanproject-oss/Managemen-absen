const CACHE_NAME = 'absensi-pwa-v3';
const ASSETS_TO_CACHE = [
  './',
  './Index.html',
  './index.html',
  './manifest.json',
  './image/icon-192.png',
  './image/icon-512.png',
  './image/icon-maskable-512.png',
  './image/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[SW] Cache warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.protocol.startsWith('ws') || url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
