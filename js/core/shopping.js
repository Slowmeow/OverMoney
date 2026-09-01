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

  /* Сводка по нескольким неделям: что всего купить за месяц, почём и сколько
   * это весит.
   *
   * Вес считается по-настоящему полезным: сколько килограммов придётся
   * донести из магазина. Поэтому складывается купленный вес, а не съедобный —
   * кожуру тоже несут в руках. Штучное без массы (туалетная бумага, губки)
   * в вес не идёт: сложить рулоны с граммами нельзя.
   *
   * Недели складываются как отдельные закупки, а не как одна большая. Это
   * не приближение, а правда: упаковки покупаются в каждый поход заново,
   * и объединять их в один список значило бы занизить сумму на переплате
   * за целые пачки — ровно на той ошибке, из-за которой считаем по упаковкам. */
  function monthSummary(plans) {
    const totals = {};
    let cost = 0, weight = 0;
    const weeks = [];

    plans.forEach(function (entry) {
      const list = buildList(entry.plan);
      cost += list.total;
      list.items.forEach(function (it) {
        if (it.buyAmount <= 0) return;
        const id = it.product.id;
        const acc = totals[id] || (totals[id] = { product: it.product, amount: 0, cost: 0, packs: 0 });
        acc.amount += it.buyAmount;
        acc.cost += it.cost;
        acc.packs += it.packs;
        // Вес имеет смысл только там, где базовая единица — грамм.
        if (it.product.unit !== 'ml' && it.product.pack >= 50) weight += it.buyAmount;
      });
      weeks.push({ start: entry.start, plan: entry.plan, list: list, label: entry.label });
    });

    const items = Object.keys(totals).map(k => totals[k]).sort((a, b) => b.cost - a.cost);
    return {
      items: items,
      cost: Math.round(cost),
      weightKg: Math.round(weight / 100) / 10,
      weeks: weeks,
      byCategory: groupByCategory(items.map(i => ({
        product: i.product, cost: i.cost, buyAmount: i.amount, packs: i.packs
      })))
    };
  }

  /* Дни небольшой докупки внутри недели.
   *
   * Всё, что нужно на неделю, в понедельник не купишь: молоко, творог и фарш
   * до пятницы не доживут. Значит за ними идут отдельно, и это не прихоть
   * приложения, а то, как люди и так делают. Считаем прямо: продукт нужен
   * в такой-то день, а срок хранения короче, чем прошло с начала недели —
   * до этого дня он не долежит, покупать надо ближе к готовке. */
  function topUpDays(plan) {
    const byId = S().productsById();
    const perDay = {};

    plan.days.forEach(function (day, di) {
      day.meals.forEach(function (meal) {
        if (!meal || !meal.recipe) return;
        const mult = buyMult(meal);
        if (mult <= 0) return;
        meal.recipe.ing.forEach(function (i) {
          const product = byId[i.p];
          if (!product || !product.life) return;
          if (product.life > di) return;           // до этого дня долежит
          const bucket = perDay[di] || (perDay[di] = { day: di, date: day.date, items: [], cost: 0 });
          bucket.items.push({ product: product, grams: i.g * mult });
          bucket.cost += i.g * mult * S().pricePerBase(product);
        });
      });
    });

    return Object.keys(perDay).map(k => perDay[k])
      .map(b => Object.assign(b, { cost: Math.round(b.cost) }))
      .filter(b => b.cost >= 50)                   // ради полтинника отдельно не ходят
      .sort((a, b) => a.day - b.day);
  }

  window.App = window.App || {};
  window.App.shopping = {
    monthSummary, topUpDays,
    aggregate, buildList, costOf, pantryAfter, buyMult, weighStep, roundUp, unitRates,
    formatAmount, formatMass, formatPurchase, groupByCategory
  };
})();
