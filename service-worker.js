/* Service worker: la app funciona sin conexión.
   - Archivos de la app: primero la red (así siempre llega la última versión
     publicada) y, si no hay conexión, la copia guardada.
   - Fuentes de Google: primero la copia guardada.
   - MusicBrainz, portadas y el servidor de sincronización: no se tocan.
   Solo borra cachés que empiezan por "vinilos-": en ivanchux.github.io
   conviven otras apps con las suyas. */

const CACHE = 'vinilos-v2.0.0';
const APP = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/dialogos.js',
  './js/store.js',
  './js/sync.js',
  './js/portadas.js',
  './js/ui.js',
  './js/iconos.js',
  './js/util.js',
  './js/config.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)));
  // Primera instalación: activarse ya. Actualizaciones: esperar a que la app lo pida.
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('message', (e) => {
  if (e.data === 'activar') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('vinilos-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(req).then(
        (r) =>
          r ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copia = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copia));
            }
            return res;
          })
      )
    );
    return;
  }
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
