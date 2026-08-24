/* Точка входа: навигация между экранами и общие действия. */
(function () {
  'use strict';

  const ORDER = ['dashboard', 'week', 'list', 'pantry', 'prices', 'settings'];
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

  function init() {
    window.App.store.load();
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

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим просто не включится */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
