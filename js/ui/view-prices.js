/* Цены и каталог. Здесь приложение становится точным: пока цены не выправлены
   по вашим чекам, все суммы — оценка. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;

  let filterCat = 'all';
  let search = '';
  let onlyStale = false;

  function render() {
    const u = U(), h = u.h;
    const state = S().get();
    let products = S().products();

    const staleCount = products.filter(p => S().isStale(p)).length;

    if (filterCat !== 'all') products = products.filter(p => p.cat === filterCat);
    if (search.trim().length > 1) {
      const q = search.trim().toLowerCase();
      products = products.filter(p => p.n.toLowerCase().indexOf(q) !== -1);
    }
    if (onlyStale) products = products.filter(p => S().isStale(p));

    products.sort((a, b) => a.n.localeCompare(b.n, 'ru'));

    return h('div.view', {}, [
      u.card('Цены', [
        h('p.hint', { text: 'Стартовые цены — ориентировочные для Пятёрочки и Магнита, они помечены знаком ~. ' +
          'Каждая правка сохраняется с датой; всё старше ' + state.settings.priceStaleDays +
          ' дней снова считается непроверенным. Не проверено сейчас: ' + staleCount + '.' }),
        filters()
      ]),
      u.card(null, [
        h('div.price-list', {}, products.map(row))
      ]),
      u.card('Свой продукт', [
        h('p.hint', { text: 'Если чего-то нет в каталоге — добавьте. Он сразу станет доступен в рецептах, ' +
          'кладовой и в подборе замен.' }),
        u.button('Добавить продукт', addProductDialog, 'primary')
      ])
    ]);
  }

  function filters() {
    const u = U(), h = u.h;
    const cats = [{ value: 'all', label: 'Все категории' }].concat(
      window.App.CATEGORY_ORDER.map(c => ({ value: c, label: window.App.CATEGORIES[c] }))
    );

    return h('div.filters', {}, [
      h('input.input', {
        type: 'search', placeholder: 'Поиск по названию', value: search,
        oninput: function (e) { search = e.target.value; window.App.ui.refresh(); }
      }),
      u.select(cats, filterCat, function (v) { filterCat = v; window.App.ui.refresh(); }),
      h('label.checkline', {}, [
        h('input', {
          type: 'checkbox', checked: onlyStale,
          onchange: function (e) { onlyStale = e.target.checked; window.App.ui.refresh(); }
        }),
        h('span', { text: 'Только непроверенные' })
      ])
    ]);
  }

  function row(product) {
    const u = U(), h = u.h;
    const state = S().get();
    const stale = S().isStale(product);
    const excluded = !!state.excluded[product.id];
    const days = S().daysSince(product.pd);
    const brands = S().brandsOf(product.id);
    const history = S().priceHistory(product.id);

    const priceInput = h('input.input.price-input', {
      type: 'number', value: product.pr, min: '0', step: '1',
      onchange: function (e) {
        const value = parseFloat(e.target.value);
        if (!(value > 0)) return;
        S().setPrice(product.id, value);
        u.toast('Сохранено: ' + product.n);
        window.App.ui.refresh();
      }
    });

    return h('div.price-row' + (excluded ? '.excluded' : ''), {}, [
      h('div.price-main', {}, [
        h('span.price-name', { text: product.n }),
        h('span.price-meta', {
          text: (product.brand ? product.brand + ' · ' : '') + product.pl +
            ' · ' + Math.round(product.k) + ' ккал/100 · Б' + product.p + ' Ж' + product.f + ' У' + product.c
        })
      ]),
      h('div.price-input-wrap', {}, [
        priceInput,
        h('span.price-age' + (stale ? '.stale' : ''), {
          text: product.seed ? 'не проверено' : (days === 0 ? 'сегодня' : days + ' дн. назад')
        })
      ]),
      h('div.price-actions', {}, [
        u.button(brands.length > 1 ? 'Марки · ' + brands.length : 'Марки', () => brandsDialog(product), 'ghost small'),
        history.length ? u.button('История', () => historyDialog(product), 'ghost small') : null
      ]),
      h('label.checkline.tight', {}, [
        h('input', {
          type: 'checkbox', checked: excluded,
          onchange: function (e) {
            if (e.target.checked) state.excluded[product.id] = true;
            else delete state.excluded[product.id];
            S().save();
            window.App.ui.refresh();
          }
        }),
        h('span', { text: 'не предлагать' })
      ])
    ]);
  }

  /* Марки одного продукта: у каждой своя цена и своя упаковка, поэтому
     сравнивать их можно только по цене за килограмм. */
  function brandsDialog(product) {
    const u = U(), h = u.h;
    const state = S().get();
    const brands = S().brandsOf(product.id);
    const chosen = state.brandChoice[product.id];
    const unit = product.unit === 'ml' ? 'л' : 'кг';

    const list = h('div.brand-list', {}, brands.length ? brands
      .slice()
      .sort((a, b) => a.pr / (a.pack || product.pack) - b.pr / (b.pack || product.pack))
      .map(function (b) {
        const pack = b.pack || product.pack;
        const perUnit = b.pr / pack * 1000;
        const isChosen = chosen === (b.brand || '');
        const isCheapest = b === brands.slice().sort((x, y) => x.pr / (x.pack || product.pack) - y.pr / (y.pack || product.pack))[0];

        return h('div.brand-row' + (isChosen ? '.chosen' : ''), {}, [
          h('div.brand-main', {}, [
            h('span.brand-title', { text: b.brand || 'без марки' }),
            h('span.brand-meta', {
              text: b.pr + ' ₽ за ' + Math.round(pack) + (product.unit === 'ml' ? ' мл' : ' г') +
                ' · ' + Math.round(perUnit) + ' ₽/' + unit +
                (b.store ? ' · ' + b.store : '') + ' · ' + b.d
            })
          ]),
          isCheapest && !chosen ? h('span.brand-tag', { text: 'идёт в расчёт' }) : null,
          u.button(isChosen ? 'Выбрана' : 'Брать эту', function () {
            if (isChosen) delete state.brandChoice[product.id];
            else state.brandChoice[product.id] = b.brand || '';
            S().save();
            document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
            window.App.ui.refresh();
          }, isChosen ? 'small primary' : 'small')
        ]);
      }) : h('p.hint', { text: 'Пока ни одной записи. Добавьте первую ниже.' }));

    const f = {};
    const mk = (k, v, attrs) => (f[k] = h('input.input', Object.assign({ value: v }, attrs || {})));
    const stores = (state.stores || []).map(s => ({ value: s, label: s }));
    let store = stores.length ? stores[0].value : '';

    const form = h('div.form-grid', {}, [
      u.field('Марка', mk('brand', ''), 'например, Простоквашино'),
      u.field('Магазин', stores.length ? u.select(stores, store, v => { store = v; }) : mk('store', '')),
      u.field('Цена за упаковку, ₽', mk('pr', product.pr, { type: 'number', min: '0', step: '1' })),
      u.field('Размер упаковки', mk('pack', product.pack, { type: 'number', min: '1' }),
        product.unit === 'ml' ? 'мл' : 'г'),
      u.field('Дата покупки', mk('date', S().today(), { type: 'date' }))
    ]);

    u.modal('Марки: ' + product.n, [
      h('p.hint', { text: 'В расчёты идёт выбранная марка, а если ничего не выбрано — самая дешёвая ' +
        'за ' + unit + '. Цена за упаковку для сравнения не годится: упаковки у марок разные.' }),
      list,
      h('h4.sub-head', { text: 'Записать цену' }),
      form
    ], [
      { label: 'Закрыть' },
      {
        label: 'Записать', cls: 'primary', onClick: function () {
          const price = parseFloat(f.pr.value);
          if (!(price > 0)) { u.toast('Нужна цена', 'bad'); return true; }
          S().recordPrice(product.id, {
            pr: price,
            brand: f.brand.value,
            store: stores.length ? store : (f.store ? f.store.value : ''),
            pack: parseFloat(f.pack.value) || product.pack,
            date: f.date.value || S().today()
          });
          u.toast('Записано: ' + product.n);
          window.App.ui.refresh();
        }
      }
    ]);
  }

  /* График цены во времени: линия на каждую марку. */
  function historyDialog(product) {
    const u = U(), h = u.h;
    const entries = S().priceHistory(product.id);
    const unit = product.unit === 'ml' ? 'л' : 'кг';

    // Группируем по марке — цвет закреплён за маркой, а не за местом в списке.
    const byBrand = {};
    entries.forEach(function (e) {
      const key = e.brand || 'без марки';
      (byBrand[key] = byBrand[key] || []).push({
        x: e.d,
        y: Math.round(e.pr / (e.pack || product.pack) * 1000)
      });
    });

    const names = Object.keys(byBrand).sort();
    // Больше пяти линий не рисуем: соседние станут неразличимы.
    const shown = names.slice(0, 5);
    const series = shown.map((name, i) => ({
      name: name,
      color: window.App.charts.seriesColor(i),
      points: byBrand[name]
    }));

    const chart = window.App.charts.lineChart({
      title: product.n,
      subtitle: 'Цена за ' + unit + ' — так марки с разными упаковками сравнимы между собой.' +
        (names.length > shown.length ? ' Показаны первые ' + shown.length + ' марок из ' + names.length + '.' : ''),
      series: series,
      yFormat: v => window.App.charts.fmtInt(v) + ' ₽',
      height: 230
    });

    u.modal('История цены', chart, [{ label: 'Закрыть' }]);
  }

  function addProductDialog() {
    const u = U(), h = u.h;
    const f = {};
    const mk = (key, value, attrs) => (f[key] = h('input.input', Object.assign({ value: value }, attrs || {})));

    const cats = window.App.CATEGORY_ORDER.map(c => ({ value: c, label: window.App.CATEGORIES[c] }));
    let cat = 'grocery', unit = 'g', weighed = 'no', grp = 'none', role = 'other';

    const groups = [
      { value: 'none', label: 'без замены' },
      { value: 'prot_meat', label: 'мясо и птица' },
      { value: 'prot_fish', label: 'рыба' },
      { value: 'prot_dairy', label: 'творог и сыр' },
      { value: 'prot_legume', label: 'бобовые' },
      { value: 'carb_grain', label: 'крупы' },
      { value: 'carb_pasta', label: 'макароны' },
      { value: 'veg_base', label: 'овощи базовые' },
      { value: 'veg_fresh', label: 'овощи свежие' },
      { value: 'fat_oil', label: 'масло растительное' },
      { value: 'fruit', label: 'фрукты' },
      { value: 'bread', label: 'хлеб' }
    ];
    const roles = [
      { value: 'protein', label: 'источник белка' },
      { value: 'carb', label: 'источник углеводов' },
      { value: 'fat', label: 'источник жиров' },
      { value: 'veg', label: 'овощи' },
      { value: 'fruit', label: 'фрукты' },
      { value: 'other', label: 'прочее' }
    ];

    const body = h('div.form-grid', {}, [
      u.field('Название', mk('n', '')),
      u.field('Категория', u.select(cats, cat, v => { cat = v; })),
      u.field('Единица', u.select([{ value: 'g', label: 'граммы' }, { value: 'ml', label: 'миллилитры' }], unit, v => { unit = v; })),
      u.field('Весовой товар', u.select([{ value: 'no', label: 'нет, пачками' }, { value: 'yes', label: 'да, на развес' }], weighed, v => { weighed = v; })),
      u.field('Размер упаковки', mk('pack', 500, { type: 'number', min: '1' }), 'для весовых укажите 1000 (цена за кг)'),
      u.field('Как выглядит на полке', mk('pl', 'пачка 500 г')),
      u.field('Цена за упаковку, ₽', mk('pr', 100, { type: 'number', min: '0' })),
      u.field('Ккал на 100', mk('k', 0, { type: 'number', min: '0' })),
      u.field('Белки на 100', mk('p', 0, { type: 'number', min: '0', step: '0.1' })),
      u.field('Жиры на 100', mk('f', 0, { type: 'number', min: '0', step: '0.1' })),
      u.field('Углеводы на 100', mk('c', 0, { type: 'number', min: '0', step: '0.1' })),
      u.field('Роль в рационе', u.select(roles, role, v => { role = v; })),
      u.field('Чем можно заменять', u.select(groups, grp, v => { grp = v; }))
    ]);

    u.modal('Новый продукт', body, [
      { label: 'Отмена' },
      {
        label: 'Добавить', cls: 'primary', onClick: function () {
          const name = f.n.value.trim();
          if (!name) { u.toast('Нужно название', 'bad'); return true; }

          const state = S().get();
          const id = 'custom_' + Date.now().toString(36);
          state.customProducts.push({
            id: id, n: name, cat: cat, unit: unit,
            pack: parseFloat(f.pack.value) || 500,
            pl: f.pl.value.trim() || 'упаковка',
            w: weighed === 'yes',
            pr: parseFloat(f.pr.value) || 0,
            k: parseFloat(f.k.value) || 0,
            p: parseFloat(f.p.value) || 0,
            f: parseFloat(f.f.value) || 0,
            c: parseFloat(f.c.value) || 0,
            wst: 0, life: 180,
            grp: grp === 'none' ? null : grp,
            role: role,
            pd: S().today(), seed: false
          });
          S().save();
          u.toast('Продукт добавлен');
          window.App.ui.refresh();
        }
      }
    ]);
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.prices = { title: 'Цены', render: render };
})();
