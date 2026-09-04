// Service Worker de Values Irradiation WEB-210
// Objetivo: que la propia app (HTML/CSS/JS) cargue aunque no haya conexión,
// sin que eso impida que las actualizaciones lleguen a los usuarios.
//
// Estrategia:
//  - App shell (HTML/CSS/JS/manifest): "red primero" — si hay conexión,
//    se pide siempre la versión más reciente (y se deja en caché para la
//    próxima vez); solo se usa la copia guardada si falla la red (sin
//    conexión). Antes esto era al revés y por eso las actualizaciones no
//    llegaban a los usuarios aunque se redesplegara la app.
//  - Imágenes/iconos: "caché primero" con actualización en segundo plano —
//    cambian poco, así se sirven al instante y se refrescan solas.
//  - /api/* nunca se intercepta: siempre va directo a la red.

const CACHE_NAME = 'vi-web210-v2';
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './manifest.json',
];
const ASSETS = [
  './img/mosquito_icon.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/logo_tie_mosquito.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([...APP_SHELL, ...ASSETS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function esAppShell(pathname) {
  return pathname === '/' || pathname.endsWith('.html') || pathname.endsWith('.js') ||
    pathname.endsWith('.css') || pathname.endsWith('manifest.json');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo GET, solo nuestro propio dominio, y nunca /api/* (eso siempre red real)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (esAppShell(url.pathname)) {
    // App shell: red primero, para que las actualizaciones lleguen siempre
    // que haya conexión; si falla (sin conexión), se sirve la última copia.
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Resto de recursos (imágenes, iconos...): caché primero, con
  // actualización en segundo plano para la próxima vez.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
