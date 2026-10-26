/* Service worker: lets the portal open offline once it has been loaded once.
   Own files: network first (volunteers always get the latest plan), cached copy when offline.
   Library files from CDNs: cache first. Weather, maps and geocoding are never cached. */
const CACHE = 'volunteer-portal-v3';
const SHELL = ['./', './index.html', './tokens.css', './base.css', './calendar.css', './styles.css', './locations.js', './app.js',
  './volunteer_plan_2027.json', './_DSC0363.webp', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const LIBRARY_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return response;
    }).catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
  } else if (LIBRARY_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok || response.type === 'opaque') { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return response;
    })));
  }
});