/* =============================================================================
   SERVICE WORKER — el motivo por el que la app abre sin señal.
   Estrategia: la aplicación (código) se sirve SIEMPRE desde caché; la red solo
   se usa para actualizarla en segundo plano. Los datos nunca dependen de esto:
   viven en IndexedDB.
   ========================================================================== */

const CACHE = 'registro-campo-v1.0.0';
const ARCHIVOS = [
  './', './index.html', './estilos.css', './manifest.webmanifest', './icono.svg',
  './js/catalogo.js', './js/db.js', './js/xlsx.js', './js/ocr.js', './js/app.js'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;                       // los POST de envío no se cachean
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // API externa: directo a la red

  ev.respondWith(
    // ignoreSearch: el index pide los scripts con ?v=… para forzar actualización
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const red = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
        }
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || red;                                   // caché primero: abre al instante
    })
  );
});

/* No hay Background Sync a propósito: iOS no lo soporta y no se promete envío
   con la app cerrada. El reintento ocurre con la app abierta: al volver la
   señal (evento 'online'), cada 2 minutos y al reabrirla.
   Ver js/app.js → sincronizarAhora(). */
