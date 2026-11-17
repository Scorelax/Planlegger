// Service worker: gjør appen installerbar og lar den starte uten nett.
// Øk VERSION ved hver utgivelse for å tvinge frem oppdatering av cachen.
const VERSION = 'planlegger-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/config.js', './js/state.js', './js/store.js', './js/util.js', './js/logic.js',
  './js/views/inventory.js', './js/views/shopping.js', './js/views/recipes.js', './js/views/settings.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase SDK fra gstatic: versjonerte filer, cache først.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Egne filer: nettverk først (alltid nyeste versjon), cache som reserve offline.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw new Error('offline');
    }
  })());
});
