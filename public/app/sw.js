/* KGC members' app — service worker. Caches the app shell so it opens instantly and works offline.
   Never caches /api (member data always comes fresh from the server). Bump VERSION after editing app files. */
const VERSION = 'kgc-app-v1', SHELL = ['/app/', '/app/app.css', '/app/app.js', '/js/config.js', '/app/manifest.webmanifest', '/app/icons/icon-192.png', '/images/kgc-logo.jpg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') { // network first, fall back to the cached app
    e.respondWith(fetch(r).then(res => { caches.open(VERSION).then(c => c.put('/app/', res.clone())); return res; }).catch(() => caches.match('/app/')));
    return;
  }
  e.respondWith(caches.match(r).then(hit => { // stale-while-revalidate
    const net = fetch(r).then(res => { if (res.ok) caches.open(VERSION).then(c => c.put(r, res.clone())); return res; }).catch(() => hit);
    return hit || net;
  }));
});
