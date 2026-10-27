const CACHE_NAME = 'lumora-v3-380lines';
const urlsToCache = ['/', '/index.html', '/manifest.json'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
  self.skipWaiting();
});
self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.map(n => { if (n !== CACHE_NAME) return caches.delete(n); }))));
  self.clients.claim();
});
