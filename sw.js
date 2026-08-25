/* Кэш для работы без интернета: список покупок должен открываться в магазине,
   где связи может не быть. */
/* Номер меняется при каждом обновлении файлов: при активации нового
   service worker старый кеш целиком удаляется, поэтому в браузере
   не может остаться половина старой версии приложения. */
const CACHE = 'spendings-v7';

const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/data/products.js',
  'js/data/recipes.js',
  'js/core/nutrition.js',
  'js/core/sync.js',
  'js/core/store.js',
  'js/core/shopping.js',
  'js/core/planner.js',
  'js/ui/helpers.js',
  'js/ui/charts.js',
  'js/ui/view-dashboard.js',
  'js/ui/view-week.js',
  'js/ui/view-list.js',
  'js/ui/view-pantry.js',
  'js/ui/view-prices.js',
  'js/ui/view-reports.js',
  'js/ui/view-settings.js',
  'js/app.js',
  'manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Сначала сеть — чтобы правки файлов подхватывались сразу; кэш как запасной вариант. */
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(function () {
        return caches.match(event.request, { ignoreSearch: true })
          .then(hit => hit || caches.match('index.html'));
      })
  );
});
