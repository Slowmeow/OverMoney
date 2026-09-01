/* Календарь: месяц на одном экране.
 *
 * Месяц здесь — это витрина, а не единица планирования. Считает по-прежнему
 * недельный движок: закупка, кладовая и подгонка под бюджет живут неделей,
 * и это свойство задачи, а не ограничение кода. Месяц склеивается из недель,
 * каждая собрана тем же проверенным путём.
 *
 * Отсюда важное следствие для дней закупок: они не выдуманы для красоты.
 * День закупки — это понедельник недели, потому что именно на неделю
 * считается список покупок, и сумма на нём — настоящая стоимость этого списка.
 */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;
  const P = () => window.App.planner;

  const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  // Приёмы пищи узнаются в сетке по значку — подписи туда не влезают.
  const MEAL_ICONS = { breakfast: '☕', lunch: '🍲', dinner: '🍽', snack: '🍎' };

  // Какой месяц показан и чей взгляд выбран. Живут между перерисовками,
  // но не сохраняются: это положение взгляда, а не данные.
  let shownMonth = null;          // первое число показываемого месяца
  let whoseView = 'all';          // 'all' или id профиля
  let openDay = null;             // раскрытый день

  function monthStart(date) {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function shiftMonth(delta) {
    const d = shownMonth || monthStart(new Date());
    shownMonth = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    openDay = null;
    U().refresh();
  }

  // Дни докупки считаются по всему плану, поэтому не на каждую клетку заново:
  // тридцать клеток — это тридцать проходов по неделе на ровном месте.
  let topUpCache = null;

  function topUpAt(dateStr) {
    if (!topUpCache) {
      topUpCache = {};
      const weeks = S().allWeeks();
      Object.keys(weeks).forEach(function (start) {
        window.App.shopping.topUpDays(weeks[start]).forEach(function (t) {
          topUpCache[t.date] = t;
        });
      });
    }
    return topUpCache[dateStr] || null;
  }

  function render() {
    const u = U(), h = u.h;
    topUpCache = null;
    if (!shownMonth) shownMonth = monthStart(new Date());

    return h('div.view.cal-view', {}, [
      eatersRow(),
      monthCard(),
      openDay ? dayCard(openDay) : hintCard()
    ]);
  }

  // ---------------------------------------------------------------- едоки

  /* Кружочки едоков. Переключают не меню, а взгляд на него: готовится одна
     кастрюля, но порция и КБЖУ у каждого свои, и увидеть их по отдельности
     полезнее, чем общую цифру на всех. */
  function eatersRow() {
    const u = U(), h = u.h;
    const people = S().get().people || [];

    function circle(id, label, title) {
      const active = whoseView === id;
      return h('button.eater' + (active ? '.active' : ''), {
        type: 'button',
        title: title,
        'aria-pressed': active ? 'true' : 'false',
        onclick: function () { whoseView = id; u.refresh(); }
      }, [
        h('span.eater-face', { text: label }),
        h('span.eater-name', { text: title })
      ]);
    }

    return h('div.eaters', {}, [
      circle('all', '👥', 'Все'),
      ...people.map(p => circle(p.id, initials(p.name), p.name))
    ]);
  }

  function initials(name) {
    const clean = String(name || '?').trim();
    return clean ? clean[0].toUpperCase() : '?';
  }

  // ---------------------------------------------------------------- месяц

  function monthCard() {
    const u = U(), h = u.h;
    const first = shownMonth;
    const title = MONTHS_NOM[first.getMonth()] + ' ' + first.getFullYear();

    return u.card(null, [
      h('div.cal-head', {}, [
        u.button('‹', () => shiftMonth(-1), 'ghost small'),
        h('h2.cal-title', { text: title }),
        u.button('›', () => shiftMonth(1), 'ghost small')
      ]),
      h('div.cal-grid', {}, [
        ...WEEKDAYS.map(d => h('div.cal-wd', { text: d })),
        ...cells(first)
      ]),
      legend(),
      weekActions(first)
    ], 'cal-card');
  }

  /* Сетка месяца всегда начинается с понедельника: иначе числа скачут
     по столбцам и календарь перестаёт читаться с одного взгляда. */
  function cells(first) {
    const out = [];
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const today = S().today();

    for (let i = 0; i < lead; i++) out.push(U().h('div.cal-cell.empty'));

    for (let n = 1; n <= daysInMonth; n++) {
      const date = new Date(first.getFullYear(), first.getMonth(), n);
      out.push(cell(S().localDate(date), n, S().localDate(date) === today));
    }
    return out;
  }

  function cell(dateStr, num, isToday) {
    const u = U(), h = u.h;
    const found = S().dayAt(dateStr);
    const isShopDay = S().weekStart(dateStr) === dateStr;
    const week = found ? found.plan : S().weekAt(S().weekStart(dateStr));

    const topUp = found ? topUpAt(dateStr) : null;

    const classes = ['cal-cell'];
    if (isToday) classes.push('today');
    if (openDay === dateStr) classes.push('open');
    if (!found) classes.push('blank');
    if (isShopDay && week) classes.push('shop');
    else if (topUp) classes.push('topup');

    const kids = [h('span.cal-num', { text: String(num) })];

    if (isShopDay && week) {
      // Сумма на дне закупки — стоимость списка именно этой недели,
      // а не доля от месяца: в магазин идут с ней.
      kids.push(h('span.cal-shop', { text: u.money(week.cost || 0) }));
    } else if (topUp) {
      // Небольшая докупка: то, что до этого дня просто не долежит.
      kids.push(h('span.cal-topup', { text: '+' + u.money(topUp.cost) }));
    }

    if (found) {
      const meals = found.day.meals.filter(m => m.recipe);
      kids.push(h('span.cal-meals', {},
        meals.map(m => h('span.cal-meal', { title: m.recipe.n, text: MEAL_ICONS[m.slot] || '•' }))));
      kids.push(h('span.cal-kcal', { text: dayKcal(found) + ' ккал' }));
    }

    return h('button.' + classes.join('.'), {
      type: 'button',
      onclick: function () {
        openDay = (openDay === dateStr) ? null : dateStr;
        U().refresh();
      }
    }, kids);
  }

  /* Калории дня — либо на всех, либо на выбранного едока. Личная доля берётся
     из раскладки приёма пищи по людям, а не делением поровну: нормы разные. */
  function dayKcal(found) {
    if (whoseView === 'all') return Math.round((found.day.nutrition || {}).kcal || 0);
    let sum = 0;
    found.day.meals.forEach(function (meal) {
      if (!meal.recipe) return;
      const portions = P().mealPortions(found.plan, meal);
      const mine = portions.find(x => x.name === personName(whoseView));
      if (mine) sum += mine.kcal;
    });
    return Math.round(sum);
  }

  function personName(id) {
    const p = (S().get().people || []).find(x => x.id === id);
    return p ? p.name : '';
  }

  function legend() {
    const u = U(), h = u.h;
    return h('div.cal-legend', {}, [
      h('span', {}, [h('i.dot.shop'), 'большая закупка на неделю']),
      h('span', {}, [h('i.dot.topup'), 'докупить скоропорт']),
      h('span', {}, [h('i.dot.today'), 'сегодня']),
      h('span', {}, [h('i.dot.blank'), 'неделя ещё не собрана'])
    ]);
  }

  /* Собрать недостающие недели показанного месяца.
     Каждая считается тем же движком, поэтому кнопка честно предупреждает,
     сколько их и что это займёт время. */
  function weekActions(first) {
    const u = U(), h = u.h;
    const missing = missingWeeks(first);
    if (!missing.length) {
      return h('p.hint', { text: 'Весь месяц собран. Нажмите на день, чтобы увидеть, что в нём.' });
    }
    return h('div.row-actions', {}, [
      u.button('Собрать недели этого месяца (' + missing.length + ')', function () {
        u.busy('Собираю ' + missing.length + ' нед. …', function () {
          missing.forEach(function (startDate) {
            const plan = P().generate({ startDay: startDate });
            S().setWeek(startDate, plan);
          });
          u.refresh();
          u.toast('Собрано недель: ' + missing.length);
        });
      }, 'primary'),
      h('p.hint', { text: 'Каждая неделя считается отдельно — по своей закупке и своей кладовой. ' +
        'Так работает движок, и это не упрощение: закупка живёт неделей.' })
    ]);
  }

  /* Недели, которые задевают показанный месяц и ещё не собраны. */
  function missingWeeks(first) {
    const out = [];
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    let cursor = S().weekStart(S().localDate(first));
    const edge = S().weekStart(S().localDate(last));
    let guard = 0;
    while (cursor <= edge && guard++ < 10) {
      if (!S().weekAt(cursor)) out.push(cursor);
      const next = new Date(cursor + 'T00:00:00');
      next.setDate(next.getDate() + 7);
      cursor = S().localDate(next);
    }
    return out;
  }

  // ---------------------------------------------------------------- день

  function hintCard() {
    const u = U(), h = u.h;
    return u.card('Как это читать', [
      h('p', { text: 'Каждая клетка — день. Значки под числом: что едят, по приёмам пищи. ' +
        'Понедельник помечен как день закупки — на нём стоит сумма, с которой идти в магазин.' }),
      h('p.hint', { text: 'Кружочки сверху переключают взгляд: нажмите на человека — ' +
        'и калории будут показаны его, а не общие на всех.' })
    ]);
  }

  function dayCard(dateStr) {
    const u = U(), h = u.h;
    const found = S().dayAt(dateStr);
    const d = new Date(dateStr + 'T12:00:00');
    const title = d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + fullWeekday(d);

    if (!found) {
      return u.card(title, [
        h('p', { text: 'Эта неделя ещё не собрана.' }),
        h('div.row-actions', {}, u.button('Собрать эту неделю', function () {
          const start = S().weekStart(dateStr);
          u.busy('Собираю неделю…', function () {
            S().setWeek(start, P().generate({ startDay: start }));
            u.refresh();
            u.toast('Неделя собрана');
          });
        }, 'primary'))
      ]);
    }

    return u.card(title, [
      ...found.day.meals.filter(m => m.recipe).map(m => mealRow(found.plan, m)),
      dayFooter(found)
    ], 'day-card');
  }

  function fullWeekday(d) {
    const names = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    return names[d.getDay()];
  }

  /* Блюдо в раскрытом дне.
   *
   * Состав спрятан под нажатие намеренно: в списке из четырёх приёмов пищи
   * развёрнутые ингредиенты — это простыня, в которой не видно главного,
   * то есть что вообще едят. КБЖУ же стоит сразу под названием, потому что
   * ради него всё и затевалось. */
  function mealRow(plan, meal) {
    const u = U(), h = u.h;
    const slotName = (window.App.MEALS[meal.slot] || {}).n || meal.slot;
    const portions = P().mealPortions(plan, meal);
    const shown = whoseView === 'all'
      ? null
      : portions.find(x => x.name === personName(whoseView));

    const nut = shown || meal.nutrition || {};
    const weight = shown ? shown.grams : totalWeight(plan, meal);

    const body = h('div.meal-detail', { hidden: true }, [
      h('p.hint', { text: 'Состав на всю кастрюлю:' }),
      h('ul.plain', {}, meal.recipe.ing.map(function (i) {
        const prod = S().productsById()[i.p];
        if (!prod) return null;
        return h('li', { text: prod.n + ' — ' + window.App.shopping.formatAmount(prod, i.g * meal.mult) });
      })),
      meal.recipe.st ? h('p.hint', { text: meal.recipe.st }) : null
    ]);

    return h('div.meal-row', {}, [
      h('button.meal-head', {
        type: 'button',
        onclick: function () { body.hidden = !body.hidden; }
      }, [
        h('span.meal-slot', { text: MEAL_ICONS[meal.slot] || '•' }),
        h('span.meal-main', {}, [
          h('span.meal-name', { text: meal.recipe.n }),
          h('span.meal-nut', {
            text: Math.round(nut.kcal || 0) + ' ккал · Б ' + Math.round(nut.p || 0) +
              ' · Ж ' + Math.round(nut.f || 0) + ' · У ' + Math.round(nut.c || 0) +
              (weight ? ' · ~' + Math.round(weight) + ' г' : '')
          }),
          h('span.meal-who', { text: shown ? shown.name : slotName + ' · на всех' })
        ]),
        // Кто это ест — видно кружочками, как в сетке.
        h('span.meal-eaters', {}, portions.map(p2 =>
          h('span.eater-mini' + (shown && p2.name === shown.name ? '.on' : ''), {
            title: p2.name, text: initials(p2.name)
          })))
      ]),
      body
    ]);
  }

  function totalWeight(plan, meal) {
    const byId = S().productsById();
    return meal.recipe.ing.reduce(function (sum, i) {
      const p = byId[i.p];
      return p ? sum + i.g * meal.mult * (1 - (p.wst || 0)) : sum;
    }, 0);
  }

  function dayFooter(found) {
    const u = U(), h = u.h;
    const cost = P().dayCost(found.plan, found.day);
    const isShopDay = S().weekStart(found.day.date) === found.day.date;

    const topUp = topUpAt(found.day.date);

    return h('div.day-foot', {}, [
      topUp ? h('div.note', {}, [
        h('p', { text: 'В этот день зайти за скоропортящимся — примерно на ' + u.money(topUp.cost) + ':' }),
        h('ul.plain', {}, topUp.items.map(i =>
          h('li', { text: i.product.n + ' — ' + window.App.shopping.formatAmount(i.product, i.grams) }))),
        h('p.hint', { text: 'Эти продукты не долежат с большой закупки: срок хранения короче, ' +
          'чем прошло дней с начала недели. Их стоимость уже входит в сумму недели, ' +
          'это не сверх бюджета.' })
      ]) : null,
      h('p.hint', { text: 'Еда этого дня обходится примерно в ' + u.money(cost) +
        '. Это доля от закупки на неделю, а не отдельный поход в магазин.' }),
      isShopDay
        ? h('div.row-actions', {}, u.button('Список покупок на эту неделю', function () {
            u.go('list');
          }, 'primary'))
        : null
    ]);
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.calendar = { title: 'Календарь', render: render };
})();
