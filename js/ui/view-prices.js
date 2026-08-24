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
          text: product.pl + ' · ' + Math.round(product.k) + ' ккал/100 · Б' + product.p + ' Ж' + product.f + ' У' + product.c
        })
      ]),
      h('div.price-input-wrap', {}, [
        priceInput,
        h('span.price-age' + (stale ? '.stale' : ''), {
          text: product.seed ? 'не проверено' : (days === 0 ? 'сегодня' : days + ' дн. назад')
        })
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
