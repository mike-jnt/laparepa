/* La Parepa C2.11 - caché controlada del shell */
'use strict';
const VERSION = 'C2.11-HIDDEN-RECOVERY-TOOLS';
const STATIC_CACHE = `laparepa-static-${VERSION}`;
const RUNTIME_CACHE = `laparepa-runtime-${VERSION}`;
const APP_SHELL = [
  './', './index.html?v=C2.11', './finanzas.html?v=C2.11', './inventario.html?v=C2.11', './nomina.html?v=C2.11',
  './manifest.webmanifest?v=C2.11', './css/modules-c2.css?v=C2.11', './css/tailwind.generated.css?v=C2.11', './css/tables-c2.6.css?v=C2.11',
  './js/lp-core-c2.js?v=C2.11', './js/lp-pos-c2.js?v=C2.11', './js/lp-finanzas-c2.js?v=C2.11',
  './js/lp-inventario-c2.js?v=C2.11', './js/lp-nomina-c2.js?v=C2.11', './assets/logo-laparepa.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('laparepa-') && ![STATIC_CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || (await caches.match('./index.html?v=C2.11'));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(async response => {
    if (response && (response.ok || response.type === 'opaque')) await cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then(cached => cached || networkFirst(request)));
    return;
  }
  if (['script', 'style', 'font'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
