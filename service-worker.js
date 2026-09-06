const CACHE_NAME = 'taxi-papoli-v1';
const APP_SHELL = [
  './',
  './index.html',
  './login.html',
  './setup.html',
  './manifest.json',
  './logo.png',
  './assets/gh-storage.js',
  './assets/libs/jalali-datepicker.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// فقط فایل‌های خود سایت را کش می‌کنیم؛ تماس‌های api.github.com همیشه مستقیم از شبکه انجام می‌شوند
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // درخواست‌های گیت‌هاب دست‌نخورده می‌مانند

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      }).catch(() => cached);
    })
  );
});
