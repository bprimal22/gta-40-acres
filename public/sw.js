const CACHE_NAME = 'ut-campus-views-v9';
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/credits.txt'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ut-campus-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Only content-hashed build assets are immutable. Unversioned models,
  // textures and HTML revalidate so returning players see the latest release.
  const immutable = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(url.pathname);

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached && immutable) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          // Cache quota/write failures must not discard a successful response.
          try { await cache.put(request, response.clone()); } catch { /* Best effort. */ }
        }
        return response;
      } catch {
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await cache.match('/');
          if (shell) return shell;
        }
        return new Response('The local campus build is not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});
