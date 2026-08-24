/* Кладовая: что уже есть дома. Всё отсюда вычитается из списка покупок,
   и на это же приложение ориентируется, когда подбирает блюда. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;
  const SH = () => window.App.shopping;

  let query = '';

  function render() {
    const u = U(), h = u.h;
    const state = S().get();
    const byId = S().productsById();
    const ids = Object.keys(state.pantry).filter(id => byId[id]);

    const value = ids.reduce((sum, id) => sum + state.pantry[id] * S().pricePerBase(byId[id]), 0);

    return h('div.view', {}, [
      u.card('Что есть дома', [
        h('p.hint', { text: 'Отметьте продукты, которые уже лежат в холодильнике и шкафу. ' +
          'Приложение вычтет их из списка покупок и постарается собрать меню вокруг них, ' +
          'чтобы ничего не пропало.' }),
        addRow(byId)
      ]),
      ids.length ? u.card('В кладовой на ' + u.money(value), [
        h('div.pantry-list', {}, ids
          .sort((a, b) => byId[a].n.localeCompare(byId[b].n, 'ru'))
          .map(id => pantryRow(byId[id], state.pantry[id]))),
        h('div.row-actions', {}, [
          u.button('Пересобрать неделю с учётом кладовой', () => window.App.ui.generate(), 'primary'),
          u.button('Очистить всё', function () {
            if (!confirm('Убрать все записи из кладовой?')) return;
            state.pantry = {};
            S().save();
            window.App.ui.refresh();
          }, 'ghost')
        ])
      ]) : u.card('Кладовая пуста', [
        h('p', { text: 'Пока приложение считает, что дома нет ничего, и включает в список все продукты из меню.' })
      ], 'muted'),
      leftoversHint()
    ]);
  }

  function addRow(byId) {
    const u = U(), h = u.h;
    const products = S().products().filter(p => p.role !== 'nonfood');

    const search = h('input.input', {
      type: 'search', placeholder: 'Найти продукт: картофель, гречка, яйца…',
      value: query,
      oninput: function (e) {
        query = e.target.value;
        renderResults();
      }
    });

    const results = h('div.search-results');

    function renderResults() {
      results.innerHTML = '';
      const q = query.trim().toLowerCase();
      if (q.length < 2) {
        results.appendChild(h('p.hint', { text: 'Введите хотя бы две буквы.' }));
        return;
      }
      const found = products.filter(p => p.n.toLowerCase().indexOf(q) !== -1).slice(0, 12);
      if (!found.length) {
        results.appendChild(h('p.hint', { text: 'Ничего не нашлось. Добавить свой продукт можно на вкладке «Цены».' }));
        return;
      }
      found.forEach(p => results.appendChild(addCandidate(p)));
    }

    renderResults();
    return h('div.add-block', {}, [search, results]);
  }

  function addCandidate(product) {
    const u = U(), h = u.h;
    const units = unitOptions(product);
    let unit = units[0].value;

    const amount = h('input.input.small-input', { type: 'number', value: 1, min: '0', step: '0.1' });
    const unitSel = u.select(units, unit, v => { unit = v; });

    return h('div.candidate', {}, [
      h('span.candidate-name', { text: product.n }),
      amount,
      unitSel,
      u.button('Добавить', function () {
        const value = parseFloat(amount.value) || 0;
        if (value <= 0) return;
        S().pantryAdd(product.id, value * unitFactor(product, unit));
        u.toast(product.n + ' — добавлено в кладовую');
        window.App.ui.refresh();
      }, 'small primary')
    ]);
  }

  function unitOptions(product) {
    const base = product.unit === 'ml' ? 'мл' : 'г';
    const big = product.unit === 'ml' ? 'л' : 'кг';
    const opts = [];
    if (product.piece) opts.push({ value: 'piece', label: 'шт' });
    if (!product.w) opts.push({ value: 'pack', label: product.pl });
    opts.push({ value: 'big', label: big });
    opts.push({ value: 'base', label: base });
    return opts;
  }

  function unitFactor(product, unit) {
    if (unit === 'piece') return product.piece || 1;
    if (unit === 'pack') return product.pack;
    if (unit === 'big') return 1000;
    return 1;
  }

  function pantryRow(product, grams) {
    const u = U(), h = u.h;
    const value = grams * S().pricePerBase(product);

    const amount = h('input.input.small-input', {
      type: 'number', value: Math.round(grams), min: '0', step: '10',
      onchange: function (e) {
        S().pantrySet(product.id, parseFloat(e.target.value) || 0);
        window.App.ui.refresh();
      }
    });

    return h('div.pantry-row', {}, [
      h('div.pantry-main', {}, [
        h('span.pantry-name', { text: product.n }),
        h('span.pantry-meta', { text: SH().formatAmount(product, grams) + ' · ' + u.money(value) })
      ]),
      amount,
      h('span.unit-tag', { text: product.unit === 'ml' ? 'мл' : 'г' }),
      u.button('Убрать', function () {
        S().pantrySet(product.id, 0);
        window.App.ui.refresh();
      }, 'ghost small')
    ]);
  }

  function leftoversHint() {
    const u = U(), h = u.h;
    return u.card('Откуда здесь берутся продукты сами', [
      h('ul.plain', {}, [
        h('li', { text: 'Вы добавляете вручную — например, привезли овощи с дачи.' }),
        h('li', { text: 'После нажатия «Закупка завершена» сюда падают остатки от начатых упаковок: ' +
          'взяли пачку риса 800 г, по меню ушло 300 г — 500 г остаются здесь и в следующий раз не покупаются.' })
      ])
    ], 'muted');
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.pantry = { title: 'Кладовая', render: render };
})();
