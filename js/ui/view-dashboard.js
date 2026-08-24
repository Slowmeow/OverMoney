/* Обзор: куда уходит бюджет, попадаем ли в норму, что приложение изменило ради денег. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;

  function render() {
    const u = U(), h = u.h;
    const state = S().get();
    const budget = S().weeklyBudget();
    const plan = state.plan;

    return h('div.view', {}, [
      warnings(),
      budgetCard(budget),
      plan ? planCard(plan, budget) : emptyPlanCard(),
      plan ? nutritionCard(plan) : null,
      plan ? adjustmentsCard(plan) : null
    ]);
  }

  function warnings() {
    const u = U(), h = u.h;
    const state = S().get();
    const items = [];

    if (state.people.some(p => p.needsSetup)) {
      items.push(warn('Профили не заполнены — нормы считаются по значениям по умолчанию.',
        'Заполнить', () => window.App.ui.go('settings')));
    }

    const stale = S().products().filter(p => S().isStale(p) && !state.excluded[p.id]);
    if (stale.length) {
      items.push(warn('Цены не проверены: ' + stale.length + ' поз. Пока это оценка, а не ваш чек.',
        'Проверить цены', () => window.App.ui.go('prices')));
    }

    return items.length ? h('div.warn-stack', {}, items) : null;
  }

  function warn(text, actionLabel, onClick) {
    const u = U(), h = u.h;
    return h('div.warn', {}, [
      h('span.warn-text', { text: text }),
      u.button(actionLabel, onClick, 'small')
    ]);
  }

  function budgetCard(b) {
    const u = U(), h = u.h;
    const s = S().get().settings;
    const periodName = s.period === 'month' ? 'месяц' : 'неделю';

    const rows = [
      ['Бюджет на ' + periodName, u.money(s.budget), 'total'],
      ['В пересчёте на неделю', u.money(b.gross), ''],
      ['− еда вне дома', '−' + u.money(b.outside), 'minus'],
      ['− регулярное и бытовое', '−' + u.money(b.regulars), 'minus'],
      ['На продукты в неделю', u.money(b.food), 'result']
    ];

    return u.card('Бюджет', [
      h('table.kv', {}, h('tbody', {}, rows.map(r =>
        h('tr' + (r[2] ? '.' + r[2] : ''), {}, [
          h('td', { text: r[0] }),
          h('td.num', { text: r[1] })
        ])
      ))),
      h('p.hint', { text: 'Бытовая химия и еда вне дома вычитаются из бюджета до планирования меню — ' +
        'иначе список продуктов «влезал» бы в сумму, которой на самом деле нет.' })
    ]);
  }

  function emptyPlanCard() {
    const u = U(), h = u.h;
    return u.card('Плана пока нет', [
      h('p', { text: 'Соберите неделю: приложение подберёт блюда под ваши калории и БЖУ, ' +
        'вычтет то, что уже лежит дома, и подгонит стоимость под бюджет.' }),
      u.button('Собрать неделю', function () { window.App.ui.generate(); }, 'primary')
    ]);
  }

  function planCard(plan, budget) {
    const u = U(), h = u.h;
    const limit = budget.food;
    const diff = limit - plan.cost;
    const over = diff < 0;
    const ratio = limit > 0 ? plan.cost / limit : 0;

    return u.card('Неделя на ' + u.money(plan.cost), [
      h('div.big-figure' + (over ? '.over' : '.under'), {}, [
        h('span.big-num', { text: (over ? '−' : '+') + u.money(Math.abs(diff)) }),
        h('span.big-cap', { text: over ? 'не хватает до бюджета' : 'остаётся свободным' })
      ]),
      h('div.bar-track.wide', {}, h('div.bar-fill.' + (over ? 'high' : 'ok'), {
        style: { width: Math.min(100, ratio * 100) + '%' }
      })),
      h('p.hint', { text: 'Стоимость посчитана по целым упаковкам и с вычетом кладовой: ' +
        'это сумма в кассе, а не сумма граммов из рецептов.' }),
      plan.notes.length ? h('div.note', {}, plan.notes.map(n => h('p', { text: n }))) : null,
      h('div.row-actions', {}, [
        u.button('Открыть список покупок', () => window.App.ui.go('list'), 'primary'),
        u.button('Посмотреть меню', () => window.App.ui.go('week')),
        u.button('Пересобрать неделю', () => window.App.ui.generate())
      ]),
      surplusIdeas(plan)
    ]);
  }

  function surplusIdeas(plan) {
    const u = U(), h = u.h;
    const ideas = window.App.planner.upgradeSuggestions(plan);
    if (!ideas.length) return null;
    return h('div.ideas', {}, [
      h('h3', { text: 'Свободные деньги можно потратить так' }),
      h('ul', {}, ideas.map(i => h('li', {
        text: i.from + ' → ' + i.to + '  (+' + i.extra + ' ₽ в неделю)'
      })))
    ]);
  }

  function nutritionCard(plan) {
    const u = U(), h = u.h;
    const avg = plan.nutrition.avgDay;
    const target = plan.targets.daily;

    return u.card('КБЖУ, средний день на всех едоков', [
      u.bar(avg.kcal, target.kcal, 'Калории'),
      u.bar(avg.p, target.p, 'Белки, г'),
      u.bar(avg.f, target.f, 'Жиры, г'),
      u.bar(avg.c, target.c, 'Углеводы, г'),
      h('p.hint', { text: 'Норма — сумма по всем профилям. Разложить по людям можно в настройках, ' +
        'задав каждому свои цифры.' })
    ]);
  }

  function adjustmentsCard(plan) {
    const u = U(), h = u.h;
    if (!plan.swaps.length && !plan.replacements.length) return null;

    const savedTotal = plan.swaps.reduce((s, x) => s + x.saved, 0) +
      plan.replacements.reduce((s, x) => s + (x.saved || 0), 0);

    return u.card('Что приложение изменило ради бюджета', [
      h('p.hint', { text: 'Калории и белок при этих заменах остались в норме — иначе замена откатывалась. ' +
        'Всего сэкономлено ' + u.money(savedTotal) + ' в неделю.' }),
      h('ul.swaps', {}, [
        plan.swaps.map(s => h('li', {}, [
          h('span.swap-from', { text: s.from }),
          h('span.swap-arrow', { text: '→' }),
          h('span.swap-to', { text: s.to }),
          h('span.swap-saved', { text: '−' + u.money(s.saved) })
        ])),
        plan.replacements.filter(r => r.reason === 'budget').map(r => h('li', {}, [
          h('span.swap-from', { text: r.from }),
          h('span.swap-arrow', { text: '→' }),
          h('span.swap-to', { text: r.to }),
          h('span.swap-saved', { text: '−' + u.money(r.saved || 0) })
        ])),
        plan.replacements.filter(r => r.reason === 'protein').map(r => h('li', {}, [
          h('span.swap-to', { text: 'Добавлено ради белка: ' + r.to })
        ]))
      ])
    ]);
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.dashboard = { title: 'Обзор', render: render };
})();
