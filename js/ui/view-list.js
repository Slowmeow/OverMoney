/* Список покупок: что взять, сколько это стоит и что уже есть дома. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;
  const SH = () => window.App.shopping;

  function render() {
    const u = U(), h = u.h;
    const state = S().get();
    const plan = state.plan;

    if (!plan) {
      return h('div.view', {}, u.card('Списка нет', [
        h('p', { text: 'Список появится, как только будет собрана неделя.' }),
        u.button('Собрать неделю', () => window.App.ui.generate(), 'primary')
      ]));
    }

    const list = SH().buildList(plan);
    const budget = S().weeklyBudget();

    return h('div.view', {}, [
      summary(list, budget, plan),
      h('div.list-groups', {}, list.byCategory.map(group => groupCard(group))),
      pantryCovered(list),
      regularsCard(),
      finishCard(plan, list)
    ]);
  }

  function summary(list, budget, plan) {
    const u = U(), h = u.h;
    const diff = budget.food - list.total;
    return u.card('Итого ' + u.money(list.total), [
      h('div.summary-grid', {}, [
        stat('Бюджет на продукты', u.money(budget.food)),
        stat(diff >= 0 ? 'Остаётся' : 'Не хватает', u.money(Math.abs(diff)), diff >= 0 ? 'good' : 'bad'),
        stat('Сэкономлено кладовой', u.money(list.savedByPantry), 'good'),
        stat('Позиций купить', String(list.byCategory.reduce((s, g) => s + g.items.length, 0)))
      ]),
      h('p.hint', { text: 'Цены с пометкой ~ ещё не проверялись вами. Поправьте их прямо в списке ' +
        'после закупки — приложение запомнит и следующая неделя посчитается точнее.' }),
      h('div.row-actions', {}, [
        u.button('Печать / PDF', () => window.print()),
        u.button('Скопировать текстом', copyAsText)
      ])
    ]);
  }

  function stat(label, value, tone) {
    const u = U(), h = u.h;
    return h('div.stat' + (tone ? '.' + tone : ''), {}, [
      h('span.stat-value', { text: value }),
      h('span.stat-label', { text: label })
    ]);
  }

  function groupCard(group) {
    const u = U(), h = u.h;
    const state = S().get();

    return h('section.card.list-group', {}, [
      h('h2.card-title', {}, [
        h('span', { text: group.name }),
        h('span.group-sum', { text: u.money(group.sum) })
      ]),
      h('div.card-body', {}, group.items.map(function (item) {
        const id = item.product.id;
        const checked = !!state.listState[id];

        const priceBox = u.numberInput(item.product.pr, function (value) {
          if (value <= 0) return;
          S().setPrice(id, value);
          u.toast('Цена обновлена: ' + item.product.n);
          window.App.ui.refresh();
        }, { step: '1', min: '0', class: 'input price-input' });

        return h('div.item' + (checked ? '.done' : ''), {}, [
          h('input.check', {
            type: 'checkbox', checked: checked,
            onchange: function (e) {
              if (e.target.checked) state.listState[id] = true;
              else delete state.listState[id];
              S().save();
              window.App.ui.refresh();
            }
          }),
          h('div.item-main', {}, [
            h('span.item-name', { text: item.product.n }),
            h('span.item-meta', {
              text: SH().formatPurchase(item) +
                (item.fromPantry > 0 ? ' · дома уже есть ' + SH().formatMass(item.product, item.fromPantry) : '') +
                (item.leftover > 20 ? ' · останется ' + SH().formatMass(item.product, item.leftover) : '')
            })
          ]),
          h('div.item-price', {}, [
            h('span.item-cost', { text: (item.stale ? '~' : '') + u.money(item.cost) }),
            h('label.price-edit', {}, [
              h('span', { text: 'цена за ' + item.product.pl }),
              priceBox
            ])
          ])
        ]);
      }))
    ]);
  }

  function pantryCovered(list) {
    const u = U(), h = u.h;
    const covered = list.items.filter(i => i.fromPantry > 0);
    if (!covered.length) return null;

    return u.card('Берём из кладовой, покупать не нужно', [
      h('ul.plain', {}, covered.map(i => h('li', {
        text: i.product.n + ' — ' + SH().formatMass(i.product, i.fromPantry) +
          (i.remaining > 0.5 ? ' (не хватает ' + SH().formatMass(i.product, i.remaining) + ', это в списке выше)' : '')
      }))),
      h('p.hint', { text: 'Итого не потрачено: ' + u.money(list.savedByPantry) + '.' })
    ], 'muted');
  }

  function regularsCard() {
    const u = U(), h = u.h;
    const reg = S().regularsWeeklyCost();
    if (!reg.items.length) return null;

    return u.card('Регулярное и бытовое', [
      h('p.hint', { text: 'Это не привязано к меню — берите по мере окончания. ' +
        'В бюджете уже зарезервировано ' + u.money(reg.total) + ' в неделю.' }),
      h('ul.plain', {}, reg.items.map(i => h('li', {
        text: i.product.n + ' — ' + i.product.pl + ', ' + u.money(i.product.pr) +
          ' (≈' + u.money(i.cost) + ' в неделю)'
      })))
    ], 'muted');
  }

  function finishCard(plan, list) {
    const u = U(), h = u.h;
    return u.card('После закупки', [
      h('p', { text: 'Нажмите, когда вернётесь из магазина: остатки от начатых упаковок ' +
        'перейдут в кладовую, и следующая неделя будет дешевле на их стоимость.' }),
      u.button('Закупка завершена', () => finish(plan, list), 'primary')
    ]);
  }

  function finish(plan, list) {
    const u = U(), h = u.h;
    const computed = list.total;
    const inputEl = u.numberInput(computed, () => {}, { step: '1', min: '0' });

    u.modal('Сколько получилось по чеку?', [
      h('p.hint', { text: 'Расчётная сумма — ' + u.money(computed) + '. ' +
        'Если в чеке другая цифра, впишите её: она попадёт в историю и покажет, ' +
        'насколько план расходится с реальностью.' }),
      u.field('Фактическая сумма, ₽', inputEl)
    ], [
      { label: 'Отмена' },
      {
        label: 'Записать', cls: 'primary', onClick: function () {
          const state = S().get();
          const actual = parseFloat(inputEl.value) || computed;

          state.pantry = SH().pantryAfter(plan, list);

          // Сохраняем не только сумму: без калорий, белка и разбивки по отделам
          // потом невозможно построить ни структуру трат, ни стоимость калории.
          const byCat = {};
          list.byCategory.forEach(g => { byCat[g.cat] = g.sum; });

          state.history.push({
            date: S().today(),
            planned: computed,
            actual: actual,
            budget: S().weeklyBudget().food,
            kcal: plan.nutrition ? plan.nutrition.week.kcal : null,
            protein: plan.nutrition ? plan.nutrition.week.p : null,
            byCat: byCat
          });
          state.listState = {};
          S().save();
          u.toast('Записано. Остатки перенесены в кладовую.');
          window.App.ui.go('pantry');
        }
      }
    ]);
  }

  function copyAsText() {
    const u = U();
    const plan = S().get().plan;
    const list = SH().buildList(plan);
    const lines = [];
    list.byCategory.forEach(function (g) {
      lines.push('— ' + g.name + ' —');
      g.items.forEach(i => lines.push('  ' + i.product.n + ': ' + SH().formatPurchase(i) + ' — ' + Math.round(i.cost) + ' ₽'));
    });
    lines.push('');
    lines.push('Итого: ' + list.total + ' ₽');

    const text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => u.toast('Список скопирован'));
    } else {
      u.modal('Список покупок', window.App.ui.h('pre.pre', { text: text }), [{ label: 'Закрыть' }]);
    }
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.list = { title: 'Список', render: render };
})();
