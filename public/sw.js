/*
 * Daymark offline shell.
 * Navigations stay network-first so a new deploy is picked up immediately;
 * the cached shell only serves when the network is unreachable. Failed
 * navigations are not stored. Hashed build assets stay cache-first, and a
 * successful navigation drops hashes the new shell no longer references.
 */
const CACHE = 'daymark-shell-v2';

function rememberNavigation(response) {
  if (!response.ok || response.type !== 'basic') return Promise.resolve();
  // Clone before the page reads the original body.
  const shell = response.clone();
  const htmlCopy = response.clone();
  return caches.open(CACHE).then(async (cache) => {
    await cache.put('./', shell);
    let html = '';
    try {
      html = await htmlCopy.text();
    } catch {
      return;
    }
    const referenced = new Set();
    const pattern = /(?:\/daymark\/|\.\/)assets\/[^"'()\s]+/g;
    for (const match of html.matchAll(pattern)) {
      const path = match[0].startsWith('.') ? `/daymark${match[0].slice(1)}` : match[0];
      referenced.add(path);
    }
    if (!referenced.size) return;
    const keys = await cache.keys();
    await Promise.all(keys.map((request) => {
      const path = new URL(request.url).pathname;
      if (!path.includes('/daymark/assets/')) return undefined;
      if (referenced.has(path)) return undefined;
      return cache.delete(request);
    }));
  }).catch(() => undefined);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add('./'))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/daymark/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          event.waitUntil(rememberNavigation(response));
          return response;
        })
        .catch(() => caches.match('./').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/daymark/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
