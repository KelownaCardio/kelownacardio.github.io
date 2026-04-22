// KGH Cardiology — Service Worker
// Caches the app shell for offline use

var CACHE = 'kgh-v1';
var SHELL = ['/', '/index.html'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Cache-first for the app shell, network-first for API calls
  if (e.request.url.indexOf('googleapis.com') > -1 ||
      e.request.url.indexOf('anthropic.com') > -1 ||
      e.request.url.indexOf('script.google.com') > -1) {
    // Always go to network for API calls
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(response) {
        return caches.open(CACHE).then(function(c) {
          c.put(e.request, response.clone());
          return response;
        });
      });
    })
  );
});
