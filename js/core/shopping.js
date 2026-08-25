/* Превращение плана питания в список покупок.
 *
 * Здесь живёт вся «магазинная» правда, из-за которой наивные калькуляторы врут:
 *  - рис продаётся пачкой 800 г, даже если по рецепту нужно 300 г;
 *  - то, что уже лежит дома, покупать не надо;
 *  - излишек от пачки не пропадает — он переходит в кладовую на следующую неделю.
 */
(function () {
  'use strict';

  const S = () => window.App.store;

  /* Сколько каждого продукта нужно на весь план, в базовых единицах.
     Считаем по `buy`, а не по `mult`: блюдо на два дня закупается один раз,
     в день готовки, и во второй день не добавляет к списку ничего. */
  function buyMult(meal) {
    if (meal.leftoverOf != null) return 0;
    return meal.buy != null ? meal.buy : meal.mult;
  }

  function aggregate(plan) {
    const need = {};
    plan.days.forEach(function (day) {
      day.meals.forEach(function (meal) {
        if (!meal || !meal.recipe) return;
        const mult = buyMult(meal);
        if (mult <= 0) return;
        meal.recipe.ing.forEach(function (i) {
          need[i.p] = (need[i.p] || 0) + i.g * mult;
        });
      });
    });
    return need;
  }

  /* Шаг, которым реально можно взять весовой товар на кассе. */
  function weighStep(product) {
    return product.pack >= 1000 ? 50 : 10;
  }

  function roundUp(value, step) {
    return Math.ceil(value / step) * step;
  }

  /* Основная функция: потребность → что и почём покупаем. */
  function buildList(plan, opts) {
    opts = opts || {};
    const usePantry = opts.usePantry !== false;
    const byId = S().productsById();
    const pantry = usePantry ? S().get().pantry : {};
    const need = aggregate(plan);

    const items = [];
    let total = 0;
    let savedByPantry = 0;

    Object.keys(need).forEach(function (id) {
      const product = byId[id];
      if (!product) return;

      const required = need[id];
      const inPantry = Math.min(required, pantry[id] || 0);
      const remaining = required - inPantry;
      const perBase = S().pricePerBase(product);

      savedByPantry += inPantry * perBase;

      let buyAmount = 0, packs = 0, cost = 0;
      if (remaining > 0.5) {
        if (product.w) {
          buyAmount = roundUp(remaining, weighStep(product));
          packs = buyAmount / product.pack;
          cost = buyAmount * perBase;
        } else {
          packs = Math.ceil(remaining / product.pack);
          buyAmount = packs * product.pack;
          cost = packs * product.pr;
        }
      }

      total += cost;

      items.push({
        product: product,
        required: required,
        fromPantry: inPantry,
        remaining: remaining,
        buyAmount: buyAmount,
        packs: packs,
        cost: cost,
        leftover: buyAmount > 0 ? buyAmount - remaining : 0,
        stale: S().isStale(product)
      });
    });

    return {
      items: items,
      total: Math.round(total),
      savedByPantry: Math.round(savedByPantry),
      byCategory: groupByCategory(items)
    };
  }

  function groupByCategory(items) {
    const groups = {};
    items.forEach(function (it) {
      if (it.buyAmount <= 0) return;
      const cat = it.product.cat;
      (groups[cat] = groups[cat] || []).push(it);
    });
    return window.App.CATEGORY_ORDER
      .filter(cat => groups[cat] && groups[cat].length)
      .map(function (cat) {
        const list = groups[cat].sort((a, b) => b.cost - a.cost);
        return {
          cat: cat,
          name: window.App.CATEGORIES[cat],
          items: list,
          sum: Math.round(list.reduce((s, i) => s + i.cost, 0))
        };
      });
  }

  /* Быстрая оценка стоимости плана — вызывается оптимизатором на каждой итерации,
     поэтому не строит группировку. */
  function costOf(plan) {
    const byId = S().productsById();
    const pantry = S().get().pantry;
    const need = aggregate(plan);
    let total = 0;
    Object.keys(need).forEach(function (id) {
      const product = byId[id];
      if (!product) return;
      const remaining = need[id] - Math.min(need[id], pantry[id] || 0);
      if (remaining <= 0.5) return;
      if (product.w) total += roundUp(remaining, weighStep(product)) * S().pricePerBase(product);
      else total += Math.ceil(remaining / product.pack) * product.pr;
    });
    return Math.round(total);
  }

  /* Что останется в кладовой после недели: старые остатки минус съеденное
     плюс хвосты от начатых упаковок. */
  function pantryAfter(plan, list) {
    const pantry = Object.assign({}, S().get().pantry);
    list.items.forEach(function (it) {
      const id = it.product.id;
      const left = (pantry[id] || 0) - it.fromPantry + it.leftover;
      if (left > 0.5) pantry[id] = Math.round(left);
      else delete pantry[id];
    });
    return pantry;
  }

  /* Во сколько реально обходится грамм каждого продукта в этом плане.
   *
   * Не «цена за килограмм с ценника»: продукты продаются упаковками, и если
   * ради 300 г риса куплена пачка 800 г, то эти 300 г стоят всю пачку. И наоборот —
   * то, что взято из кладовой, на этой неделе не стоит ничего, деньги за него
   * заплачены раньше.
   *
   * Отсюда важное свойство: сумма стоимостей всех приёмов пищи в точности равна
   * итогу списка покупок. Наивный подсчёт занижал её на 38%.
   */
  const ratesCache = new WeakMap();

  function unitRates(plan) {
    const rev = S().revision();
    const cached = ratesCache.get(plan);
    if (cached && cached.rev === rev) return cached.rates;

    const list = buildList(plan);
    const rates = {};
    list.items.forEach(function (i) {
      rates[i.product.id] = i.required > 0 ? i.cost / i.required : 0;
    });
    ratesCache.set(plan, { rev: rev, rates: rates });
    return rates;
  }

  /* Человекочитаемое количество: где уместно — в штуках, где нет — в кг/г. */
  function formatAmount(product, amount) {
    if (amount <= 0) return '—';
    if (product.piece) {
      const pieces = amount / product.piece;
      const rounded = pieces >= 1 ? Math.round(pieces * 10) / 10 : Math.round(pieces * 100) / 100;
      return rounded + ' шт (' + formatMass(product, amount) + ')';
    }
    return formatMass(product, amount);
  }

  function formatMass(product, amount) {
    const unit = product.unit === 'ml' ? 'мл' : 'г';
    const big = product.unit === 'ml' ? 'л' : 'кг';
    if (amount >= 1000) return (Math.round(amount / 10) / 100) + ' ' + big;
    return Math.round(amount) + ' ' + unit;
  }

  /* Как это выглядит на полке: «2 пачки по 800 г» или «0,45 кг». */
  function formatPurchase(item) {
    const p = item.product;
    if (p.w) return formatMass(p, item.buyAmount);
    const n = item.packs;
    return n + ' × ' + p.pl;
  }

  window.App = window.App || {};
  window.App.shopping = {
    aggregate, buildList, costOf, pantryAfter, buyMult, weighStep, roundUp, unitRates,
    formatAmount, formatMass, formatPurchase, groupByCategory
  };
})();
