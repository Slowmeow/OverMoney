/* Меню на неделю: что и когда готовим, сколько это даёт КБЖУ и сколько стоит. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;
  const N = () => window.App.nutrition;
  const P = () => window.App.planner;
  const SH = () => window.App.shopping;

  function render() {
    const u = U(), h = u.h;
    const plan = S().get().plan;
    if (!plan) {
      return h('div.view', {}, u.card('Плана нет', [
        h('p', { text: 'Сначала соберите неделю на вкладке «Обзор».' }),
        u.button('Собрать неделю', () => window.App.ui.generate(), 'primary')
      ]));
    }

    const byId = S().productsById();
    return h('div.view', {}, [
      header(plan),
      h('div.week', {}, plan.days.map((day, di) => dayCard(plan, day, di, byId)))
    ]);
  }

  function header(plan) {
    const u = U(), h = u.h;
    const limit = plan.budget ? plan.budget.food : S().weeklyBudget().food;
    const over = plan.cost > limit;
    return u.card(null, [
      h('div.week-head', {}, [
        h('div', {}, [
          h('span.week-cost' + (over ? '.over' : ''), { text: u.money(plan.cost) }),
          h('span.week-cap', { text: ' из ' + u.money(limit) + ' на неделю' })
        ]),
        h('div.row-actions', {}, [
          u.button('Пересобрать', () => window.App.ui.generate()),
          over ? u.button('Подогнать под бюджет', function () {
            P().fitToBudget(plan, S().productsById());
            savePlan(plan);
            u.toast('Пересчитано под бюджет');
          }, 'primary') : null
        ])
      ])
    ]);
  }

  function dayCard(plan, day, di, byId) {
    const u = U(), h = u.h;
    const target = plan.targets.daily;
    const nut = day.nutrition || { kcal: 0, p: 0, f: 0, c: 0 };
    const dev = N().deviation(nut.kcal, target.kcal);

    return h('article.day', {}, [
      h('header.day-head', {}, [
        h('h3', { text: day.name }),
        h('span.day-date', { text: formatDate(day.date) }),
        h('span.day-kcal' + (Math.abs(dev) > 10 ? '.warn' : ''), {
          text: nut.kcal + ' ккал · Б ' + Math.round(nut.p) + ' · Ж ' + Math.round(nut.f) + ' · У ' + Math.round(nut.c)
        })
      ]),
      h('div.day-meals', {}, day.meals.map(meal => mealRow(plan, day, di, meal, byId)))
    ]);
  }

  function mealRow(plan, day, di, meal, byId) {
    const u = U(), h = u.h;
    const meals = window.App.MEALS;
    if (!meal.recipe) {
      return h('div.meal.empty', {}, [
        h('span.meal-slot', { text: meals[meal.slot].n }),
        h('span.meal-name', { text: '— не подобрано —' })
      ]);
    }

    const leftover = meal.leftoverOf != null;
    const nut = meal.nutrition || { kcal: 0, p: 0 };
    const cost = P().recipeCost(meal.recipe, byId, SH().buyMult(meal));

    return h('div.meal' + (leftover ? '.leftover' : ''), {}, [
      h('span.meal-slot', { text: meals[meal.slot].n }),
      h('div.meal-main', {}, [
        h('span.meal-name', { text: meal.recipe.n }),
        h('span.meal-meta', {
          text: (leftover ? 'вчерашнее, готовить не надо · ' : meal.recipe.t + ' мин · ') +
            nut.kcal + ' ккал · белок ' + Math.round(nut.p) + ' г' +
            (cost > 0 ? ' · ' + u.money(cost) : '')
        })
      ]),
      h('div.meal-actions', {}, [
        u.button('Состав', () => showRecipe(meal, byId), 'ghost small'),
        leftover ? null : u.button('Заменить', () => showAlternatives(plan, meal, di, byId), 'ghost small')
      ])
    ]);
  }

  function showRecipe(meal, byId) {
    const u = U(), h = u.h;
    const mult = meal.mult;
    const rows = meal.recipe.ing.map(function (i) {
      const p = byId[i.p];
      if (!p) return null;
      const grams = i.g * mult;
      return h('tr', {}, [
        h('td', { text: p.n }),
        h('td.num', { text: SH().formatAmount(p, grams) }),
        h('td.num', { text: u.money(grams * S().pricePerBase(p)) })
      ]);
    }).filter(Boolean);

    u.modal(meal.recipe.n, [
      h('p.hint', { text: 'Порции пересчитаны под вашу норму: коэффициент ×' + mult + ' от базового рецепта.' }),
      h('table.table', {}, [
        h('thead', {}, h('tr', {}, [h('th', { text: 'Продукт' }), h('th.num', { text: 'Нужно' }), h('th.num', { text: 'Стоимость' })])),
        h('tbody', {}, rows)
      ]),
      h('p.steps', { text: meal.recipe.st })
    ], [{ label: 'Закрыть' }]);
  }

  function showAlternatives(plan, meal, di, byId) {
    const u = U(), h = u.h;
    const alternatives = S().recipes()
      .filter(r => r.m.indexOf(meal.slot) !== -1 && r.id !== meal.recipe.id)
      .map(function (r) {
        const nut = N().recipeNutrition(r, byId);
        const slotTarget = P().targetsOf(plan)[meal.slot] || { kcal: 0 };
        const mult = slotTarget.kcal / Math.max(1, nut.total.kcal);
        return { r: r, nut: nut, mult: mult, cost: P().recipeCost(r, byId, mult) };
      })
      .sort((a, b) => a.cost - b.cost);

    const currentCost = P().recipeCost(meal.recipe, byId, SH().buyMult(meal));

    const list = h('div.alt-list', {}, alternatives.map(function (a) {
      const delta = a.cost - currentCost;
      return h('button.alt', {
        type: 'button',
        onclick: function () {
          applyReplacement(plan, meal, di, a.r, byId);
          document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
        }
      }, [
        h('span.alt-name', { text: a.r.n }),
        h('span.alt-meta', {
          text: Math.round(a.nut.perServing.kcal) + ' ккал/порция · белок ' +
            Math.round(a.nut.total.p / a.r.sv) + ' г · ' + a.r.t + ' мин'
        }),
        h('span.alt-cost' + (delta < 0 ? '.cheaper' : delta > 0 ? '.pricier' : ''), {
          text: u.money(a.cost) + (delta === 0 ? '' : ' (' + (delta > 0 ? '+' : '−') + u.money(Math.abs(delta)) + ')')
        })
      ]);
    }));

    u.modal('Чем заменить: ' + meal.recipe.n, [
      h('p.hint', { text: 'Цена указана за то же количество калорий — сравнение честное, а не «за порцию».' }),
      list
    ], [{ label: 'Отмена' }]);
  }

  function applyReplacement(plan, meal, di, recipe, byId) {
    const u = U();
    // Если у блюда был второй день — снимаем его, иначе останется висеть вчерашнее.
    plan.days.forEach(function (day) {
      day.meals.forEach(function (m) {
        if (m.leftoverOf === di && m.slot === meal.slot) { m.recipe = null; m.leftoverOf = null; }
      });
    });

    meal.recipe = Object.assign({}, recipe, { ing: recipe.ing.map(i => ({ p: i.p, g: i.g })) });

    const settings = S().get().settings;
    if (settings.batchTwoDays && recipe.batch && plan.days[di + 1]) {
      const twin = plan.days[di + 1].meals.find(m => m.slot === meal.slot && !m.recipe);
      if (twin) { twin.recipe = Object.assign({}, recipe, { ing: recipe.ing.map(i => ({ p: i.p, g: i.g })) }); twin.leftoverOf = di; }
    }

    P().rebalance(plan, byId);
    P().refillEmpty(plan, P().makeCtx(), byId); // если сняли «второй день», слот не должен остаться пустым
    plan.cost = SH().costOf(plan);
    savePlan(plan);
    u.toast('Заменено · неделя теперь ' + u.money(plan.cost));
  }

  function savePlan(plan) {
    const state = S().get();
    state.plan = plan;
    S().save();
    window.App.ui.refresh();
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0');
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.week = { title: 'Неделя', render: render };
})();
