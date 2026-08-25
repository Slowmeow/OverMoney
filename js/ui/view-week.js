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
        /* Раньше здесь была своя кнопка «Подогнать под бюджет». Она запускала
           мягкую подгонку повторно — а та уже отработала при сборке плана,
           поэтому находила от силы несколько десятков рублей и выглядела
           сломанной. При этом сообщение всегда рапортовало об успехе.
           Теперь на всех экранах один и тот же набор действий. */
        h('div.row-actions', {}, [
          u.button('Пересобрать', () => window.App.ui.generate()),
          u.budgetActions()
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
        }),
        h('span.day-cost', { text: u.money(P().dayCost(plan, day)) })
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
    // Цена по фактическим тратам: с переплатой за упаковки и без того,
    // что взято из кладовой. Сумма по всем блюдам равна списку покупок.
    const cost = P().mealCost(plan, meal);
    const cooksAhead = !leftover && SH().buyMult(meal) > meal.mult * 1.2;

    return h('div.meal' + (leftover ? '.leftover' : ''), {}, [
      h('span.meal-slot', { text: meals[meal.slot].n }),
      h('div.meal-main', {}, [
        h('span.meal-name', { text: meal.recipe.n }),
        h('span.meal-meta', {
          text: (leftover ? 'вчерашнее, готовить не надо · ' : meal.recipe.t + ' мин · ') +
            nut.kcal + ' ккал · белок ' + Math.round(nut.p) + ' г · ' + u.money(cost) +
            (cooksAhead ? ' · готовим сразу на два дня' : '')
        }),
        // Готовим одно блюдо, а нормы разные — значит и в тарелках разное.
        portionsLine(plan, meal)
      ]),
      h('div.meal-actions', {}, [
        // Передаём координаты приёма пищи, а не ссылки: план могла подменить
        // синхронизация, и старая ссылка вела бы в отброшенный объект.
        u.button('Состав', () => showRecipe(di, meal.slot), 'ghost small'),
        leftover ? null : u.button('Заменить', () => showAlternatives(di, meal.slot), 'ghost small')
      ])
    ]);
  }

  /* Кому сколько класть. Показываем только когда едоков больше одного:
     одному человеку эта строка ничего не сообщает. */
  function portionsLine(plan, meal) {
    const u = U(), h = u.h;
    const parts = P().mealPortions(plan, meal);
    if (parts.length < 2) return null;
    return h('span.meal-portions', {}, parts.map(function (x) {
      return h('span.portion', {}, [
        h('span.portion-who', { text: x.name }),
        h('span.portion-amount', { text: '≈' + x.grams + ' г' }),
        h('span.portion-kcal', { text: x.kcal + ' ккал' }),
        h('span.portion-cost', { text: u.money(x.cost) })
      ]);
    }));
  }

  /* Состав блюда — редактируемый: и граммовка, и цена продукта правятся прямо
     здесь. Без этого пришлось бы уходить на другой экран ради одной цифры,
     а увидеть результат — только вернувшись обратно. */
  function showRecipe(dayIndex, slot) {
    const u = U(), h = u.h;
    let byId = S().productsById();
    const plan = S().plan();
    const meal = S().mealAt(dayIndex, slot);
    if (!plan || !meal || !meal.recipe) return;
    const body = h('div.recipe-edit');

    function draw() {
      body.innerHTML = '';
      const mult = meal.mult;
      const nut = N().nutritionOf(meal.recipe.ing.map(i => ({ p: i.p, g: i.g * mult })), byId);
      const cost = P().mealCost(plan, meal);

      body.appendChild(h('p.hint', {
        text: 'Порции пересчитаны под вашу норму: коэффициент ×' + u.num(mult, 2) +
          ' от базового рецепта. Правьте количество и цену — итог пересчитается сразу.'
      }));

      /* Таблица, а не набор карточек: подписи вроде «₽ / бутылка 900 мл»
         у каждой строки своей длины, и поля разъезжались по горизонтали.
         Одна шапка на всю таблицу выравнивает колонки и заодно освобождает
         место — размер упаковки ушёл в строку под названием. */
      const cells = [
        h('span.rg-head', { text: 'Продукт' }),
        h('span.rg-head.rg-num', { text: 'Нужно' }),
        h('span.rg-head.rg-num', { text: 'Цена, ₽' }),
        h('span.rg-head')
      ];

      meal.recipe.ing.forEach(function (ing, idx) {
        const p = byId[ing.p];
        if (!p) return;
        const grams = ing.g * mult;
        const unit = p.unit === 'ml' ? 'мл' : 'г';

        // Количество правим в том виде, в каком оно на экране, а храним базовое:
        // иначе пользователю пришлось бы делить в уме на коэффициент.
        const gramsInput = h('input.input.rg-input', {
          type: 'number', value: Math.round(grams), min: '0', step: '5',
          'aria-label': 'Сколько нужно, ' + unit + ': ' + p.n,
          onchange: function (e) {
            const value = Math.max(0, parseFloat(e.target.value) || 0);
            meal.recipe.ing[idx].g = mult > 0 ? value / mult : value;
            commit();
          }
        });

        const priceInput = h('input.input.rg-input', {
          type: 'number', value: p.pr, min: '0', step: '1',
          'aria-label': 'Цена за ' + p.pl + ': ' + p.n,
          onchange: function (e) {
            const value = parseFloat(e.target.value);
            if (!(value > 0)) return;
            S().setPrice(p.id, value);
            byId = S().productsById();
            commit();
            u.toast('Цена обновлена: ' + p.n);
          }
        });

        cells.push(
          h('div.rg-name', {}, [
            h('span.recipe-name', { text: p.n }),
            h('span.recipe-meta', {
              text: u.money(grams * S().pricePerBase(p)) + ' · ' + p.pl +
                (p.brand ? ' · ' + p.brand : '')
            })
          ]),
          h('div.rg-field', {}, [gramsInput, h('span.rg-unit', { text: unit })]),
          h('div.rg-field', {}, priceInput),
          u.button('✕', function () {
            meal.recipe.ing.splice(idx, 1);
            commit();
          }, 'ghost small rg-drop')
        );
      });

      body.appendChild(h('div.recipe-grid', {}, cells));

      const parts = P().mealPortions(plan, meal);
      if (parts.length > 1) {
        body.appendChild(h('div.portion-box', {}, [
          h('span.field-label', { text: 'Разложить по тарелкам' }),
          h('div.portion-list', {}, parts.map(function (x) {
            return h('div.portion-row', {}, [
              h('span.portion-who', { text: x.name }),
              h('span.portion-amount', { text: '≈' + x.grams + ' г' }),
              h('span.portion-kcal', { text: x.kcal + ' ккал · белок ' + x.p + ' г' }),
              h('span.portion-cost', { text: u.money(x.cost) }),
              h('span.portion-share', { text: Math.round(x.share * 100) + '%' })
            ]);
          })),
          h('span.field-hint', { text: 'Вес приблизительный: считается по съедобной части продуктов, ' +
            'вода в супах в рецепте не указана. Цена делится в той же пропорции, ' +
            'что и порция; изменить её можно, поправив цены продуктов в таблице выше.' })
        ]));
      }

      body.appendChild(h('div.recipe-total', {}, [
        h('span.recipe-nut', { text: nut.kcal + ' ккал · Б ' + Math.round(nut.p) + ' · Ж ' + Math.round(nut.f) + ' · У ' + Math.round(nut.c) }),
        h('span.recipe-cost', { text: u.money(cost) })
      ]));

      body.appendChild(addIngredientRow());
      body.appendChild(h('p.steps', { text: meal.recipe.st }));
    }

    function commit() {
      P().rebalance(plan, byId);
      plan.cost = SH().costOf(plan);
      savePlan(plan, true);
      draw();
    }

    function addIngredientRow() {
      const products = S().products().filter(p => p.role !== 'nonfood');
      const search = h('input.input', { type: 'search', placeholder: 'Добавить продукт…' });
      const found = h('div.search-results');

      search.addEventListener('input', function () {
        found.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        if (q.length < 2) return;
        products.filter(p => p.n.toLowerCase().indexOf(q) !== -1).slice(0, 6).forEach(function (p) {
          found.appendChild(h('button.candidate-btn', {
            type: 'button', text: p.n + ' · ' + u.money(p.pr) + ' / ' + p.pl,
            onclick: function () {
              const exists = meal.recipe.ing.find(i => i.p === p.id);
              if (exists) exists.g += 50 / (meal.mult || 1);
              else meal.recipe.ing.push({ p: p.id, g: 50 / (meal.mult || 1) });
              commit();
            }
          }));
        });
      });

      return h('div.add-block', {}, [search, found]);
    }

    draw();

    u.modal(meal.recipe.n, body, [
      {
        label: 'Сохранить как свой рецепт', onClick: function () {
          const state = S().get();
          const copy = Object.assign({}, meal.recipe, {
            id: 'my_' + Date.now().toString(36),
            n: meal.recipe.n + ' (мой вариант)',
            ing: meal.recipe.ing.map(i => ({ p: i.p, g: i.g }))
          });
          state.customRecipes.push(copy);
          S().save();
          u.toast('Сохранено — теперь этот вариант будет попадать в меню');
        }
      },
      { label: 'Готово', cls: 'primary' }
    ]);
  }

  function showAlternatives(dayIndex, slot) {
    const u = U(), h = u.h;
    const byId = S().productsById();
    const plan = S().plan();
    const meal = S().mealAt(dayIndex, slot);
    if (!plan || !meal || !meal.recipe) return;
    const di = dayIndex;
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
          applyReplacement(dayIndex, slot, a.r);
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

  function applyReplacement(dayIndex, slot, recipe) {
    const u = U();
    const byId = S().productsById();
    const plan = S().plan();
    const meal = S().mealAt(dayIndex, slot);
    if (!plan || !meal) return;
    const di = dayIndex;
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

  function savePlan(plan, keepScreen) {
    const state = S().get();
    state.plan = plan;
    S().save();
    // При правке внутри модалки экран не трогаем: перерисовка закрыла бы окно
    // вместе с полем, в котором человек сейчас печатает.
    if (!keepScreen) window.App.ui.refresh();
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0');
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.week = { title: 'Неделя', render: render };
})();
