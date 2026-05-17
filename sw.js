/* =====================================================
   sw.js — KetoCare service worker
   Caches app shell + CDN scripts so the app works offline
   ===================================================== */

// Bump this version string whenever you ship an update. The browser uses
// it to detect new versions. The convention is to keep this in sync with
// the "Version" label shown on the About page in index.html.
const CACHE_NAME = 'ketocare-v1.5.2';

// Files to cache on install. Same-origin paths are relative; CDN URLs are absolute.
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './charts.js',
  './export.js',
  './app.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll fails the whole install if any one fails; use individual adds + catch instead
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] skip cache', url, err))
        )
      )
    )
    // NB: no skipWaiting() here — we wait for the page to send a SKIP_WAITING
    // message via the "Refresh" button. This lets the user choose when to update.
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Cache-first for our shell + CDN scripts (they have versioned URLs, so cache forever is OK)
  // Network-first for anything else (e.g. Google Fonts CSS, which can change)
  const isShell = PRECACHE.some((p) => {
    try {
      return new URL(p, self.location.href).href === url.href;
    } catch { return false; }
  });

  if (isShell) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((res) => {
          // Lazy-cache successful responses
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
          return res;
        }).catch(() => caches.match('./index.html'))
      )
    );
    return;
  }

  // For Google Fonts and similar, try network then fall back to cache
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(event.request))
  );
});
