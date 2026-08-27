/* Точка входа: навигация между экранами и общие действия. */
(function () {
  'use strict';

  /* Показывается в подвале. Если после обновления цифра не изменилась —
     браузер отдал страницу из кеша, и правок вы не увидите. */
  const APP_VERSION = '1.7';

  const ORDER = ['dashboard', 'week', 'list', 'pantry', 'prices', 'reports', 'settings'];
  let current = 'dashboard';

  function go(name) {
    current = window.App.views[name] ? name : 'dashboard';
    location.hash = current;
    refresh();
    window.scrollTo(0, 0);
  }

  function refresh() {
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
    ORDER.forEach(function (name) {
      const view = window.App.views[name];
      if (!view) return;
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
  }

  /* Общая база: подтягиваем при старте и при каждом возвращении к вкладке.
     Опрашивать чаще незачем — правки делает человек, а не поток событий. */
  function setupSync() {
    const sync = window.App.sync;
    const store = window.App.store;
    if (!sync) return;

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

    refresh();

    window.addEventListener('hashchange', function () {
      const name = location.hash.replace('#', '');
      if (name && name !== current && window.App.views[name]) go(name);
    });

    setupSync();

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим просто не включится */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
