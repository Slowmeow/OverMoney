/* Точка входа: навигация между экранами и общие действия. */
(function () {
  'use strict';

  /* Показывается в подвале. Если после обновления цифра не изменилась —
     браузер отдал страницу из кеша, и правок вы не увидите. */
  const APP_VERSION = '1.8';

  const ORDER = ['dashboard', 'week', 'list', 'pantry', 'prices', 'reports', 'settings', 'account'];
  let current = 'dashboard';

  /* Пока человек не вошёл и не согласился смотреть гостем, всё приложение —
     это один экран входа. Иначе первое, что видит открывший адрес, — чужой
     бюджет и чужая кладовая: данные-то лежат в браузере от прошлого хозяина
     устройства. Вход существует ровно чтобы такого не было. */
  function locked() {
    return !!(window.App.account && window.App.account.needsAuth());
  }

  function go(name) {
    if (locked()) name = 'account';
    current = window.App.views[name] ? name : 'dashboard';
    location.hash = current;
    refresh();
    window.scrollTo(0, 0);
  }

  function refresh() {
    if (locked()) current = 'account';
    const view = window.App.views[current];
    const root = document.getElementById('view');
    root.innerHTML = '';
    try {
      root.appendChild(view.render());
    } catch (err) {
      console.error(err);
      root.appendChild(window.App.ui.h('div.view', {}, [
        window.App.ui.card('Что-то сломалось', [
          window.App.ui.h('p', { text: err.message }),
          window.App.ui.h('p.hint', { text: 'Подробности — в консоли браузера (F12).' })
        ])
      ]));
    }
    renderNav();
  }

  function renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = '';
    // На экране входа вкладок нет: показывать их значило бы предлагать
    // заглянуть в данные, которых человеку ещё не полагается видеть.
    if (locked()) return;
    ORDER.forEach(function (name) {
      const view = window.App.views[name];
      if (!view) return;
      // Вкладка аккаунта появляется, только если облако вообще настроено.
      if (name === 'account' && !(window.App.cloud && window.App.cloud.available())) return;
      nav.appendChild(window.App.ui.h('button.tab' + (name === current ? '.active' : ''), {
        type: 'button',
        onclick: () => go(name),
        // Активную вкладку экранный диктор иначе не отличит от остальных:
        // подсветка цветом ему не видна.
        'aria-current': name === current ? 'page' : null,
        text: view.title
      }));
    });
  }

  /* Собрать неделю заново. Список покупок при этом обнуляется:
     отметки от прошлой закупки к новому плану не относятся. */
  function generate() {
    const u = window.App.ui;
    const store = window.App.store;

    // Подбор блюд и подгонка под бюджет считаются в потоке отрисовки —
    // на телефоне это заметная пауза. Сначала показываем, что работа идёт.
    u.busy('Собираю неделю…', function () {
      try {
        const plan = window.App.planner.generate();
        const state = store.get();
        state.plan = plan;
        state.listState = {};
        store.save();

        const limit = plan.budget ? plan.budget.food : store.weeklyBudget().food;
        const diff = limit - plan.cost;
        u.toast(diff >= 0
          ? 'Неделя собрана: ' + u.money(plan.cost) + ', остаётся ' + u.money(diff)
          : 'Собрано за ' + u.money(plan.cost) + ' — на ' + u.money(-diff) + ' больше бюджета');
        go('week');
      } catch (err) {
        console.error(err);
        u.toast('Не удалось собрать неделю: ' + err.message, 'bad');
      }
    });
  }

  /* Облачный аккаунт: забираем данные при старте и при возвращении к вкладке.
     Опрашивать чаще незачем — правки делает человек, а не поток событий. */
  function setupAccount() {
    const account = window.App.account;
    if (!account || !window.App.cloud.available()) return;

    account.onChange(function (st) {
      // Подвал обещает то, что происходит на самом деле. Пока человек
      // не вошёл, данные и правда никуда не уходят; после входа — уходят,
      // и делать вид, что нет, нельзя.
      const privacy = document.getElementById('privacy');
      if (privacy) {
        privacy.textContent = st.signedIn
          ? 'Данные хранятся в вашем аккаунте и в этом браузере.'
          : 'Данные хранятся только в этом браузере. Резервная копия — «Настройки → Данные».';
      }

      const el = document.getElementById('sync');
      if (!el) return;
      if (!st.signedIn) el.textContent = st.guest ? '· без аккаунта' : '';
      else if (st.conflict) el.textContent = '· данные разошлись';
      else if (st.error) el.textContent = '· нет связи, сохраню позже';
      else if (st.pending) el.textContent = '· сохраняю…';
      else el.textContent = '· ' + ((st.household && st.household.name) || 'синхронизировано');
    });

    account.init().then(refresh);

    function catchUp() {
      if (!window.App.cloud.signedIn()) return;
      account.pull().then(function (state) { if (state) refresh(); });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) account.flushNow();
      else catchUp();
    });
    window.addEventListener('focus', catchUp);
    window.addEventListener('online', catchUp);
    // Закрывают вкладку — отправляем не дожидаясь паузы, иначе последняя
    // правка цены в магазине останется только в этом телефоне.
    window.addEventListener('pagehide', () => account.flushNow());
  }

  /* Общая база через домашний компьютер: работает, только когда запущен
     start.bat. С облаком не конфликтует — там, где есть аккаунт, api/state
     просто не отвечает, и этот слой сам отключается. */
  function setupSync() {
    const sync = window.App.sync;
    const store = window.App.store;
    if (!sync) return;
    // Когда данными заведует облако, второй хозяин им не нужен.
    if (window.App.cloud && window.App.cloud.available()) return;

    let busy = false;

    function pull(announce) {
      if (busy) return;
      busy = true;
      sync.pull().then(function (remote) {
        busy = false;
        if (!remote) return;
        store.adopt(remote);
        refresh();
        if (announce) window.App.ui.toast('Данные обновлены с другого устройства');
      }).catch(function () { busy = false; });
    }

    sync.onChange(function (st) {
      const el = document.getElementById('sync');
      if (!el) return;
      if (st.conflict) el.textContent = '· расхождение с общей базой';
      else if (!st.available) el.textContent = '· только этот браузер';
      else if (st.pending) el.textContent = '· сохраняю…';
      else el.textContent = '· общая база';
    });

    pull(false);
    // Первое устройство наполняет пустую базу своим состоянием.
    setTimeout(() => sync.flush(() => store.get()).then(handleConflict), 400);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) pull(true);
    });
    window.addEventListener('focus', () => pull(true));
    window.addEventListener('online', () => pull(true));
  }

  /* Расхождение развязывает человек: молча затирать чужую работу нельзя. */
  function handleConflict(result) {
    if (!result || !result.conflict) return;
    const u = window.App.ui;
    const store = window.App.store;

    u.modal('Данные разошлись между устройствами', [
      u.h('p', { text: 'Пока вы работали здесь, базу изменили с другого устройства. ' +
        'Слить автоматически нельзя — придётся выбрать, какая версия верна.' }),
      u.h('p.hint', { text: 'Совет: если на другом устройстве вы только что отмечали цены в магазине, ' +
        'берите версию оттуда — здесь правки, скорее всего, мельче.' })
    ], [
      {
        label: 'Взять с другого устройства', onClick: function () {
          store.adopt(result.state);
          window.App.sync.acceptRemote(result.rev);
          refresh();
          u.toast('Приняты данные с другого устройства');
        }
      },
      {
        label: 'Оставить эти', cls: 'primary', onClick: function () {
          window.App.sync.overwrite(() => store.get()).then(function () {
            u.toast('Общая база перезаписана этой версией');
          });
        }
      }
    ]);
  }

  function init() {
    window.App.store.load();

    const versionEl = document.getElementById('version');
    if (versionEl) versionEl.textContent = 'версия ' + APP_VERSION;
    window.App.ui.go = go;
    window.App.ui.refresh = refresh;
    window.App.ui.generate = generate;

    const fromHash = location.hash.replace('#', '');
    current = window.App.views[fromHash] ? fromHash : 'dashboard';
    if (locked()) current = 'account';

    refresh();

    window.addEventListener('hashchange', function () {
      const name = location.hash.replace('#', '');
      if (name && name !== current && window.App.views[name]) go(name);
    });

    setupAccount();
    setupSync();

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим просто не включится */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
