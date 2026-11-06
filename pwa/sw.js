'use strict';
/* ============================================================
   SERVICE WORKER — WT Motor PWA
   ------------------------------------------------------------
   Solo dos funciones:
   1) cache de la app-shell para arrancar instantáneo y offline
      (la conexión real es WSS en vivo: los ticks NO se cachean)
   2) mostrar notificaciones mientras la app está abierta
   ============================================================ */
const CACHE = 'wt-pwa-v2';
const SHELL = ['./', './index.html', './app.js', './proto.js', './motor.js', './velas_db.js', './manifest.json', './icono.svg', './icono-192.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  const url = new URL(ev.request.url);
  if (url.origin !== location.origin) return;   // api.telegram.org y wss pasan directo
  ev.respondWith(
    caches.match(ev.request).then((hit) => hit || fetch(ev.request).then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put(ev.request, copia));
      return r;
    }))
  );
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
