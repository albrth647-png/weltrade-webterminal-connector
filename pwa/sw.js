'use strict';
/* ============================================================
   SERVICE WORKER — WT Motor PWA
   ------------------------------------------------------------
   Solo dos funciones:
   1) cache de la app-shell para arrancar instantáneo y offline
      (la conexión real es WSS en vivo: los ticks NO se cachean)
   2) mostrar notificaciones mientras la app está abierta

   La caché se VERSIONA SOLA: el nombre deriva del hash SHA-256 del
   contenido REAL de la shell, así que cuando este fichero cambia
   produce una caché nueva y borra la anterior en activate.

   IMPORTANTE (bug D de la auditoría en vivo): el hash solo se puede
   calcular en INSTALL, y el navegador solo re-instala el SW cuando
   CAMBIA sw.js. Con cache-first en el fetch handler, un fix de app.js
   jamás llegaba a los instalados: el SW viejo servía app.js viejo
   para siempre. Por eso el fetch es AHORA red-primero para el código
   (HTML/JS/JSON: con red SIEMPRE llega el código nuevo; la caché
   queda como respaldo offline) y caché-primero solo para iconos.
   ============================================================ */
const PREFIJO = 'wt-pwa-';
const SHELL = ['./', './index.html', './app.js', './proto.js', './motor.js', './velas_db.js', './velas_canvas.js', './radio.js', './manifest.json', './icono.svg', './icono-192.png', './icono-512.png'];
let CACHE = null;   // se fija en install: 'wt-pwa-<hash>'

async function _hashShell() {
  const partes = [];
  for (const url of SHELL) {
    const r = await fetch(url, { cache: 'reload' });   // ignora la caché HTTP
    partes.push(new TextEncoder().encode(url), new Uint8Array(await r.arrayBuffer()));
  }
  const plano = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of partes) { plano.set(p, off); off += p.length; }
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', plano))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return PREFIJO + hex.slice(0, 16);
}

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    CACHE = await _hashShell();
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith(PREFIJO) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  const url = new URL(ev.request.url);
  if (url.origin !== location.origin) return;   // api.telegram.org y wss pasan directo
  const ruta = url.pathname;
  const esCodigo = ruta.endsWith('/') || ruta.endsWith('.html') || ruta.endsWith('.js') || ruta.endsWith('.json');
  if (!esCodigo) {
    /* iconos y demás: caché-primero (no cambian, no son lógica) */
    ev.respondWith(
      caches.match(ev.request).then((hit) => hit || fetch(ev.request).then((r) => {
        if (!CACHE || !r.ok) return r;
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copia));
        return r;
      }))
    );
    return;
  }
  /* CÓDIGO: red primero. Un fix en app.js llega al recargar aunque el
     SW no haya cambiado; sin red, la caché mantiene la app arrancable. */
  ev.respondWith(
    fetch(ev.request).then((r) => {
      if (r.ok && CACHE) {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copia));   // refresco de caché
      }
      return r;
    }).catch(() => caches.match(ev.request).then((hit) => hit || Response.error()))
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
