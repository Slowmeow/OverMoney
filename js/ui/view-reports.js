/* Отчёты: куда уходят деньги и как меняется цена вашей корзины.
 *
 * Все графики читают один и тот же срез, заданный фильтром сверху, поэтому
 * числа на разных карточках всегда согласованы между собой. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;
  const C = () => window.App.charts;
  const SH = () => window.App.shopping;

  let range = 8;   // сколько последних закупок показывать

  function render() {
    const u = U(), h = u.h;
    const state = S().get();
    const all = (state.history || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const history = range === 0 ? all : all.slice(-range);

    return h('div.view', {}, [
      filters(all.length),
      kpi(history),
      u.card(null, [spendChart(history)]),
      u.card(null, [categoryChart(history)]),
      u.card(null, [efficiencyCharts(history)]),
      howItFills(all.length)
    ]);
  }

  /* Фильтр один и стоит над всем, что он охватывает, — не внутри карточек. */
  function filters(total) {
    const u = U(), h = u.h;
    const options = [
      { value: '8', label: 'последние 8 закупок' },
      { value: '26', label: 'последние 26' },
      { value: '0', label: 'всё время' }
    ];
    return h('div.filters', {}, [
      u.select(options, String(range), function (v) { range = parseInt(v, 10); window.App.ui.refresh(); }),
      h('span.hint', { text: 'Записей всего: ' + total })
    ]);
  }

  function kpi(history) {
    const u = U(), h = u.h;
    const c = C();
    const withActual = history.filter(r => r.actual > 0);

    const avg = withActual.length
      ? withActual.reduce((s, r) => s + r.actual, 0) / withActual.length : 0;
    const budget = S().weeklyBudget().food;

    const withKcal = history.filter(r => r.kcal > 0 && r.actual > 0);
    const perKcal = withKcal.length
      ? withKcal.reduce((s, r) => s + r.actual / r.kcal * 1000, 0) / withKcal.length : 0;

    const drift = withActual.filter(r => r.planned > 0);
    const avgDrift = drift.length
      ? drift.reduce((s, r) => s + (r.actual - r.planned) / r.planned, 0) / drift.length * 100 : 0;

    return u.card('Коротко', [
      h('div.summary-grid', {}, [
        c.statTile('Бюджет на неделю', u.money(budget)),
        c.statTile('Средний чек за неделю', withActual.length ? u.money(avg) : '—',
          withActual.length ? {
            text: avg <= budget ? 'укладываетесь' : 'превышение на ' + u.money(avg - budget),
            good: avg <= budget, bad: avg > budget
          } : null),
        c.statTile('План против факта', drift.length ? u.signedPct(Math.round(avgDrift)) : '—',
          drift.length ? {
            text: Math.abs(avgDrift) < 10 ? 'план близок к реальности' : 'план заметно расходится с чеком',
            good: Math.abs(avgDrift) < 10, bad: Math.abs(avgDrift) >= 10
          } : null),
        c.statTile('Рубль за 1000 ккал', perKcal ? Math.round(perKcal) + ' ₽' : '—')
      ])
    ]);
  }

  function spendChart(history) {
    const c = C(), u = U();
    const budget = S().weeklyBudget().food;

    return c.groupedBars({
      title: 'Недельные траты: план и факт',
      subtitle: 'Столбики — расчёт приложения и сумма по чеку. Черта — бюджет на продукты.',
      groups: history.map(r => ({
        label: c.fmtDate(r.date),
        values: [
          { name: 'План', value: Math.round(r.planned || 0) },
          { name: 'Факт', value: Math.round(r.actual || 0) }
        ]
      })),
      refLine: budget > 0 ? { value: Math.round(budget), label: 'бюджет ' + Math.round(budget) + ' ₽' } : null,
      yFormat: v => c.fmtInt(v) + ' ₽',
      empty: 'Появится после первой отметки «Закупка завершена» в списке покупок.'
    });
  }

  /* Структура трат: категорий девять, и раскрашивать их в девять цветов нельзя —
     соседние классы сольются. Длина столбика говорит то же самое и честнее. */
  function categoryChart(history) {
    const c = C();
    const cats = window.App.CATEGORIES;

    // Берём факт, если он есть; иначе показываем структуру текущего плана,
    // чтобы график был полезен с первого дня.
    const last = history.filter(r => r.byCat && Object.keys(r.byCat).length).pop();
    let items, subtitle;

    if (last) {
      items = Object.keys(last.byCat).map(k => ({ label: cats[k] || k, value: last.byCat[k] }));
      subtitle = 'По закупке от ' + c.fmtDate(last.date) + '.';
    } else {
      const plan = S().get().plan;
      if (!plan) {
        return c.emptyFigure({
          title: 'Куда уходят деньги',
          empty: 'Соберите неделю — и здесь появится структура будущей закупки.'
        });
      }
      const list = SH().buildList(plan);
      items = list.byCategory.map(g => ({ label: g.name, value: g.sum }));
      subtitle = 'По текущему плану — закупок в истории ещё нет.';
    }

    return c.rankedBars({
      title: 'Куда уходят деньги',
      subtitle: subtitle,
      items: items
    });
  }

  /* Две величины разного масштаба не делят одну ось: вместо второй оси —
     два отдельных графика рядом. */
  function efficiencyCharts(history) {
    const u = U(), h = u.h, c = C();
    const rows = history.filter(r => r.actual > 0 && r.kcal > 0);

    if (rows.length < 2) {
      return c.emptyFigure({
        title: 'Во сколько обходится питание',
        subtitle: 'Рубль за 1000 ккал и за 100 г белка',
        empty: 'Нужно хотя бы две завершённые закупки — по одной точке тренда не бывает.'
      });
    }

    const kcalSeries = [{
      name: '₽ за 1000 ккал',
      color: 'var(--s1)',
      points: rows.map(r => ({ x: r.date, y: Math.round(r.actual / r.kcal * 1000) }))
    }];
    const protSeries = [{
      name: '₽ за 100 г белка',
      color: 'var(--s2)',
      points: rows.filter(r => r.protein > 0).map(r => ({ x: r.date, y: Math.round(r.actual / r.protein * 100) }))
    }];

    return h('div.small-multiples', {}, [
      c.lineChart({
        title: 'Рубль за 1000 ккал',
        subtitle: 'Сколько стоит энергия в вашей корзине — своя инфляция, а не средняя по стране.',
        series: kcalSeries, height: 180, yFormat: v => c.fmtInt(v) + ' ₽'
      }),
      c.lineChart({
        title: 'Рубль за 100 г белка',
        subtitle: 'Белок — самый дорогой макронутриент, по нему разница видна раньше всего.',
        series: protSeries, height: 180, yFormat: v => c.fmtInt(v) + ' ₽'
      })
    ]);
  }

  function howItFills(total) {
    const u = U(), h = u.h;
    if (total >= 3) return null;
    return u.card('Чем это наполняется', [
      h('ul.plain', {}, [
        h('li', { text: 'Каждая отметка «Закупка завершена» в списке покупок добавляет точку: план, факт, бюджет, калории и белок за неделю.' }),
        h('li', { text: 'Цены, которые вы правите в списке или на вкладке «Цены», ложатся в журнал с датой, маркой и магазином — из него строится график цены каждого продукта.' }),
        h('li', { text: 'График цены конкретного товара открывается на вкладке «Цены» кнопкой «История».' })
      ])
    ], 'muted');
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.reports = { title: 'Отчёты', render: render };
})();
