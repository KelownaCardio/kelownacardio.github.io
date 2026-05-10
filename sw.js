// KGH Cardiology — Service Worker
// Caches the app shell for offline use
// ───────────────────────────────────────────────────────────────────
// IMPORTANT: bump CACHE_VERSION on every meaningful index.html /
// upload.html / import.html / ocr_offline.js change. The SW is what
// determines whether doctors' devices see your latest deploy — without
// a version bump here, browsers serve stale cached files indefinitely.
//
// Convention: keep this in sync with the main app's APP_VERSION.

var CACHE_VERSION = 'v3.26';
var CACHE         = 'kgh-' + CACHE_VERSION;

var SHELL = [
  '/',
  '/index.html',
  '/ocr_offline.js',
  '/manifest.json'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      // Best-effort: don't fail install if a non-essential file 404s
      return Promise.all(SHELL.map(function(url) {
        return c.add(url).catch(function() { /* ignore */ });
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  // Wipe every cache that isn't the current version. This is the
  // mechanism that ensures version bumps actually reach devices.
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; })
                            .map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always network for API calls (no caching).
  if (url.indexOf('googleapis.com')   > -1 ||
      url.indexOf('anthropic.com')    > -1 ||
      url.indexOf('script.google.com') > -1 ||
      url.indexOf('workers.dev')      > -1) {
    return;
  }

  // Network-first for HTML (so version bumps take effect immediately
  // when online). Cache-first only for non-HTML assets.
  var isHTML = e.request.mode === 'navigate' ||
               (e.request.headers.get('accept') || '').indexOf('text/html') > -1;

  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        // Update the cache with the fresh copy
        var copy = response.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
        return response;
      }).catch(function() {
        // Network failed (offline) — fall back to cache
        return caches.match(e.request);
      })
    );
    return;
  }

  // Cache-first for everything else (CSS, JS, fonts, images)
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(response) {
        var copy = response.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
        return response;
      });
    })
  );
});
