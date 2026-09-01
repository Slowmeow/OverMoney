/* Кэш для работы без интернета: список покупок должен открываться в магазине,
   где связи может не быть. */
/* Номер меняется при каждом обновлении файлов: при активации нового
   service worker старый кеш целиком удаляется, поэтому в браузере
   не может остаться половина старой версии приложения. */
const CACHE = 'spendings-v17';

/* Сколько ждём сеть, прежде чем отдать страницу из кеша.
 *
 * Прежний вариант ждал сеть без ограничения. На компьютере это незаметно —
 * сервер свой, отвечает мгновенно. А на телефоне, унёсшем приложение из дома,
 * запрос уходит на 192.168.x.x, которого в этой сети нет, и висит до
 * таймаута операционной системы — это десятки секунд, и так для каждого
 * файла страницы. Приложение, обещавшее работать офлайн, просто не
 * открывалось.
 *
 * Полутора секунд хватает и локальному серверу, чтобы успеть ответить
 * (правки в коде по-прежнему видны сразу после F5), и телефону вдали
 * от дома, чтобы не ждать зря. */
const NET_TIMEOUT = 1500;

const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/core/config.js',
  'js/data/products.js',
  'js/data/diets.js',
  'js/data/recipes.js',
  'js/core/nutrition.js',
  'js/core/cloud.js',
  'js/core/sync.js',
  'js/core/store.js',
  'js/core/merge.js',
  'js/core/account.js',
  'js/core/receipt.js',
  'js/core/shopping.js',
  'js/core/planner.js',
  'js/ui/layout.js',
  'js/ui/helpers.js',
  'js/ui/charts.js',
  'js/ui/view-calendar.js',
  'js/ui/view-dashboard.js',
  'js/ui/view-week.js',
  'js/ui/view-list.js',
  'js/ui/view-pantry.js',
  'js/ui/view-prices.js',
  'js/ui/view-reports.js',
  'js/ui/view-settings.js',
  'js/ui/view-account.js',
  'js/app.js',
  'icon.svg',
  'manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  // Поштучно, а не addAll: тот падает целиком, если не скачался один файл,
  // и тогда офлайн не работает вообще — вместо «без одной картинки».
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(ASSETS.map(url => cache.add(url).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Общую базу кешировать нельзя ни при каких условиях.
 *
 * Это не файл приложения, а изменяемое состояние. Закешированный ответ
 * `api/state` — это снимок данных на момент последнего успешного запроса,
 * и, отдав его офлайн, service worker выдаёт старьё за свежую правду.
 * Приложение верит, принимает эти данные как «пришедшие с другого
 * устройства» и записывает поверх своих — то есть откатывает работу,
 * сделанную позже. Пусть лучше запрос честно провалится: на этот случай
 * в приложении уже есть режим «только этот браузер». */
function isState(url) {
  return url.pathname.endsWith('/api/state');
}

/* Сеть с ограничением по времени; не дождались — берём из кеша. */
function fromNetwork(request) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(() => reject(new Error('таймаут сети')), NET_TIMEOUT);
    fetch(request).then(function (response) {
      clearTimeout(timer);
      // Класть в кеш ответ, который сам пришёл из кеша соседней вкладки,
      // незачем; а вот ошибку сервера кешировать — прямой вред.
      if (response && response.ok && response.type !== 'opaque') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
      }
      resolve(response);
    }).catch(function (err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function fromCache(request) {
  return caches.match(request, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    // Переходы внутри приложения — это всегда одна и та же страница,
    // маршрут живёт в адресной строке после решётки.
    if (request.mode === 'navigate') return caches.match('index.html');
    return Promise.reject(new Error('нет в кеше'));
  });
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isState(url)) return;                      // общая база — только напрямую

  event.respondWith(
    fromNetwork(request).catch(() => fromCache(request))
  );
});
