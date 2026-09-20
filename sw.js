// Service Worker de Values Irradiation WEB-210
// Objetivo: que la app cargue rápido y también sin conexión, sin impedir que
// las actualizaciones lleguen a los usuarios.
//
// Estrategia:
//  - App shell (HTML/CSS/JS propios): "red primero" — si hay conexión se pide
//    siempre la versión más reciente (y se guarda para la próxima vez). Si la
//    red falla o tarda más de 5 s, se usa la última copia guardada: así, con
//    mala cobertura, la app arranca igualmente en vez de quedarse esperando.
//  - Librerías (/vendor) y tipografías (/fonts): "caché primero" — sus nombres
//    llevan la versión, nunca cambian; se descargan una vez y se sirven al instante.
//  - Imágenes: "caché primero" con actualización en segundo plano.
//  - /api/* nunca se intercepta: siempre va directo a la red.

const CACHE_NAME = 'vi-web210-v3';
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './manifest.json',
];
// Se guardan "a la mejor": si alguno falla, la instalación no se cancela.
const ASSETS = [
  './fonts/manrope-latin-wght-normal.woff2',
  './fonts/inter-latin-wght-normal.woff2',
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-600-normal.woff2',
  './img/favicon-64.png',
  './img/mosquito_icon.png',
  './img/icon-192.png',
  './img/logo_tie_mosquito.png',
  './img/mosquito_logo_white.png',
  './img/mosquito_logo_team.png',
  './img/Logo Tragsa.png',
  './img/logo.svg',
];
const TIEMPO_RED_MS = 5000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL).then(() => Promise.allSettled(ASSETS.map((a) => cache.add(a)))))
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

function esEstatico(pathname) {
  return pathname.startsWith('/vendor/') || pathname.startsWith('/fonts/');
}
function esAppShell(pathname) {
  return pathname === '/' || pathname.endsWith('.html') || pathname.endsWith('.js') ||
    pathname.endsWith('.css') || pathname.endsWith('manifest.json');
}
function guardar(req, res) {
  if (res && res.status === 200) {
    const copia = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(req, copia)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo GET, solo nuestro propio dominio, y nunca /api/* (eso siempre red real)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Librerías y tipografías versionadas: caché primero
  if (esEstatico(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => guardar(req, res)))
    );
    return;
  }

  if (esAppShell(url.pathname)) {
    // Red primero (con tope de espera); si falla o tarda, la última copia guardada.
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        const red = fetch(req).then((res) => guardar(req, res));
        if (!cached) return red;
        const espera = new Promise((resolve) => setTimeout(() => resolve(cached), TIEMPO_RED_MS));
        return Promise.race([red.catch(() => cached), espera]);
      })
    );
    return;
  }

  // Resto (imágenes, iconos...): caché primero, con actualización en segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresca = fetch(req).then((res) => guardar(req, res)).catch(() => cached);
      return cached || fresca;
    })
  );
});
