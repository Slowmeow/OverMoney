/* Состояние приложения: настройки, профили, кладовая, цены, планы.
 * Всё хранится локально в браузере. Никаких серверов и аккаунтов. */
(function () {
  'use strict';

  const KEY = 'spendings.v1';

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function defaultPerson(id, name, sex) {
    return {
      id: id, name: name, sex: sex,
      age: 30, height: 175, weight: 75,
      activity: 1.375, goal: 'maintain',
      protPerKg: null, fatPerKg: null,
      manual: null,
      // Набор приёмов пищи у каждого свой: одному перекусы нужны, другому нет.
      meals: ['breakfast', 'lunch', 'dinner'],
      needsSetup: true
    };
  }

  function defaultState() {
    return {
      v: 1,
      settings: {
        budget: 15000,
        period: 'month',          // 'month' | 'week'
        weeksInMonth: 4.3,        // 30.4 дня / 7
        outsideFood: 0,           // еда вне дома за период, ₽
        mealsActive: ['breakfast', 'lunch', 'dinner'],
        batchTwoDays: true,       // супы и рагу растягиваем на 2 дня
        maxRepeat: 2,             // сколько раз одно блюдо может встретиться за неделю
        overspend: 0,             // допустимое превышение бюджета, доля (0 = жёсткий потолок)
        priceStaleDays: 30,
        proteinFloor: 0.9,        // белок не опускаем ниже 90% нормы даже ради бюджета
        kcalTolerance: 0.07,      // допустимый разброс калорий по дню
        startDay: today()
      },
      people: [
        defaultPerson('p1', 'Профиль 1', 'm'),
        defaultPerson('p2', 'Профиль 2', 'f')
      ],
      // Регулярные покупки вне меню: кофе, специи, бытовая химия.
      regulars: [
        { p: 'coffee', qty: 1, per: 'month' },
        { p: 'tea', qty: 1, per: 'month' },
        { p: 'salt', qty: 1, per: 'month' },
        { p: 'spices_mix', qty: 1, per: 'month' },
        { p: 'dish_soap', qty: 1, per: 'month' },
        { p: 'laundry', qty: 1, per: 'month' },
        { p: 'toilet_paper', qty: 1, per: 'month' },
        { p: 'trash_bags', qty: 1, per: 'month' },
        { p: 'shampoo', qty: 1, per: 'month' },
        { p: 'soap', qty: 1, per: 'month' },
        { p: 'toothpaste', qty: 1, per: 'month' },
        { p: 'sponges', qty: 1, per: 'month' }
      ],
      pantry: {},          // { productId: количество в базовых единицах }
      excluded: {},        // { productId: true } — не предлагать этот продукт
      prices: {},          // устаревшее: цены до появления журнала, переносятся при загрузке

      /* Журнал цен — единственный источник правды о том, сколько что стоит.
         Одна запись = «в такой-то день в таком-то магазине такая-то марка
         столько-то стоила». Из него выводятся и текущая цена для расчётов,
         и графики. Марка и упаковка хранятся в записи, потому что творог
         Простоквашино 200 г и Домик в деревне 180 г — это разные цены
         за килограмм, и без этого сравнение врёт. */
      priceLog: [],        // [{d, p, brand, store, pr, pack}]
      brandChoice: {},     // {productId: марка} — какую брать в расчёт; по умолчанию самая дешёвая
      stores: ['Пятёрочка', 'Магнит'],
      customProducts: [],
      customRecipes: [],
      disabledRecipes: {},
      plan: null,
      listState: {},       // отметки «куплено» в списке покупок
      history: []
    };
  }

  let state = null;

  function load() {
    invalidate();
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.warn('Не удалось прочитать сохранённые данные, начинаем заново', e);
      state = defaultState();
    }
    return state;
  }

  /* Дозаполняем поля, появившиеся в новых версиях, чтобы старые сохранения не ломались. */
  function migrate(saved) {
    const base = defaultState();
    const merged = Object.assign(base, saved);
    merged.settings = Object.assign(base.settings, saved.settings || {});
    merged.people = (saved.people && saved.people.length)
      ? saved.people.map(p => Object.assign(defaultPerson(p.id, p.name, p.sex), p))
      : base.people;

    // Раньше приёмы пищи были общими на всех. Переносим их в каждый профиль,
    // чтобы дальше настраивать по человеку.
    const commonMeals = (saved.settings && saved.settings.mealsActive) || base.settings.mealsActive;
    merged.people.forEach(function (p) {
      if (!Array.isArray(p.meals) || !p.meals.length) p.meals = commonMeals.slice();
    });

    // Цены, правленные до появления журнала, переносим в него — иначе
    // вся уже собранная пользователем точность потерялась бы.
    merged.priceLog = merged.priceLog || [];
    if (saved.prices && !merged.priceLog.length) {
      Object.keys(saved.prices).forEach(function (id) {
        const old = saved.prices[id];
        if (!old || !(old.pr > 0)) return;
        merged.priceLog.push({ d: old.pd || today(), p: id, brand: '', store: '', pr: old.pr, pack: null });
      });
    }

    // Планы, сохранённые до исправления, могли накопить повторяющиеся
    // предупреждения и строки замен. Чистим при загрузке, чтобы не заставлять
    // пересобирать неделю ради этого.
    if (merged.plan) {
      if (Array.isArray(merged.plan.notes)) {
        merged.plan.notes = merged.plan.notes.filter((n, i, all) => all.indexOf(n) === i);
      }
      if (Array.isArray(merged.plan.swaps)) {
        const seen = {};
        merged.plan.swaps = merged.plan.swaps.filter(function (s) {
          const key = s.from + '>' + s.to;
          if (seen[key]) { seen[key].saved += s.saved || 0; return false; }
          seen[key] = s;
          return true;
        });
      }
    }
    return merged;
  }

  function save() {
    invalidate();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      alert('Не удалось сохранить данные: ' + e.message);
    }
  }

  function get() {
    if (!state) load();
    return state;
  }

  function reset() {
    state = defaultState();
    save();
  }

  // ---------- ЖУРНАЛ ЦЕН И МАРКИ ----------

  function round2(v) { return Math.round(v * 100) / 100; }

  /* Записать цену. Повторная запись за тот же день по той же марке в том же
     магазине заменяет прежнюю — иначе исправление опечатки плодило бы точки
     на графике. */
  function recordPrice(productId, opts) {
    const s = get();
    const d = opts.date || today();
    const brand = (opts.brand || '').trim();
    const store = (opts.store || '').trim();

    s.priceLog = (s.priceLog || []).filter(
      e => !(e.p === productId && e.brand === brand && e.store === store && e.d === d)
    );
    s.priceLog.push({
      d: d, p: productId, brand: brand, store: store,
      pr: round2(opts.pr),
      pack: opts.pack || null
    });
    if (opts.prefer) s.brandChoice[productId] = brand;
    save();
  }

  function priceHistory(productId) {
    return (get().priceLog || [])
      .filter(e => e.p === productId)
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  }

  /* Последняя известная цена по каждой марке. */
  function brandsOf(productId) {
    const latest = {};
    priceHistory(productId).forEach(function (e) {
      const key = e.brand || '';
      if (!latest[key] || latest[key].d <= e.d) latest[key] = e;
    });
    return Object.keys(latest).map(k => latest[k]);
  }

  /* Какая цена идёт в расчёты: выбранная марка, иначе самая дешёвая
     за единицу веса — сравнивать по цене упаковки нельзя, упаковки разные. */
  function effectivePrice(product) {
    const brands = brandsOf(product.id);
    if (!brands.length) return null;

    const chosen = get().brandChoice[product.id];
    if (chosen !== undefined) {
      const hit = brands.find(b => (b.brand || '') === chosen);
      if (hit) return hit;
    }
    return brands.slice().sort(function (a, b) {
      return a.pr / (a.pack || product.pack) - b.pr / (b.pack || product.pack);
    })[0];
  }

  // ---------- КАТАЛОГ ПРОДУКТОВ ----------

  /* Каталог пересобирается редко, а читается на каждой итерации оптимизатора,
     поэтому результат кешируется и сбрасывается при любой записи. */
  let catalogCache = null;
  let catalogByIdCache = null;

  function invalidate() { catalogCache = null; catalogByIdCache = null; }

  /* Каталог = заготовка + свои продукты, поверх которых наложены известные цены. */
  function products() {
    if (catalogCache) return catalogCache;
    const s = get();
    const all = window.App.seedProducts.concat(s.customProducts || []);
    catalogCache = all.map(function (p) {
      const best = effectivePrice(p);
      if (!best) return p;
      return Object.assign({}, p, {
        pr: best.pr,
        pack: best.pack || p.pack,
        pd: best.d,
        brand: best.brand,
        store: best.store,
        seed: false
      });
    });
    return catalogCache;
  }

  function productsById() {
    if (catalogByIdCache) return catalogByIdCache;
    const map = {};
    products().forEach(p => { map[p.id] = p; });
    catalogByIdCache = map;
    return map;
  }

  /* Цена одной базовой единицы (грамма или миллилитра). */
  function pricePerBase(product) {
    return product.pr / product.pack;
  }

  function daysSince(dateStr) {
    if (!dateStr) return 9999;
    const diff = Date.now() - new Date(dateStr + 'T00:00:00').getTime();
    return Math.floor(diff / 86400000);
  }

  function isStale(product) {
    return product.seed || daysSince(product.pd) > get().settings.priceStaleDays;
  }

  /* Быстрая правка цены без указания марки — из списка покупок.
     Сохраняет марку и магазин, выбранные для этого продукта раньше,
     чтобы правка попадала в ту же линию графика, а не создавала новую. */
  function setPrice(productId, price) {
    const known = brandsOf(productId);
    const chosen = get().brandChoice[productId];
    const base = known.find(b => (b.brand || '') === chosen) || known[0] || {};
    recordPrice(productId, { pr: price, brand: base.brand || '', store: base.store || '', pack: base.pack || null });
  }

  // ---------- РЕЦЕПТЫ ----------

  /* Рецепт отсеивается, если содержит исключённый продукт или выключен вручную. */
  function recipes() {
    const s = get();
    const all = window.App.seedRecipes.concat(s.customRecipes || []);
    return all.filter(function (r) {
      if (s.disabledRecipes[r.id]) return false;
      return !r.ing.some(i => s.excluded[i.p]);
    });
  }

  function allRecipes() {
    const s = get();
    return window.App.seedRecipes.concat(s.customRecipes || []);
  }

  // ---------- КЛАДОВАЯ ----------

  function pantryAdd(productId, grams) {
    const s = get();
    s.pantry[productId] = Math.max(0, (s.pantry[productId] || 0) + grams);
    if (s.pantry[productId] === 0) delete s.pantry[productId];
    save();
  }

  function pantrySet(productId, grams) {
    const s = get();
    if (grams > 0) s.pantry[productId] = grams;
    else delete s.pantry[productId];
    save();
  }

  // ---------- БЮДЖЕТ ----------

  /* Приводим бюджет к неделе и вычитаем всё, что не относится к готовке дома:
     бытовую химию и еду вне дома. Остаток — это то, на что реально закупаем продукты. */
  function weeklyBudget() {
    const s = get();
    const weeks = s.settings.period === 'month' ? s.settings.weeksInMonth : 1;
    const gross = s.settings.budget / weeks;
    const outside = s.settings.outsideFood / weeks;
    const regulars = regularsWeeklyCost();
    return {
      gross: gross,
      outside: outside,
      regulars: regulars.total,
      regularsItems: regulars.items,
      food: Math.max(0, gross - outside - regulars.total)
    };
  }

  /* Периоды регулярных покупок в неделях. Шампунь берут раз в пару месяцев,
     а средство для стирки — раз в полгода; загонять это в «раз в месяц»
     значит завышать бюджет на пустом месте. */
  const PERIODS = {
    week:     { n: 'шт в неделю',    weeks: 1 },
    month:    { n: 'шт в месяц',     weeks: 4.3 },
    quarter:  { n: 'шт в 3 месяца',  weeks: 13 },
    halfyear: { n: 'шт в полгода',   weeks: 26 },
    year:     { n: 'шт в год',       weeks: 52 }
  };

  function periodWeeks(per) {
    return (PERIODS[per] || PERIODS.month).weeks;
  }

  /* Регулярные покупки в пересчёте на неделю. Дробные упаковки здесь допустимы:
     пачка кофе в месяц — это 0,23 пачки в неделю, и в бюджете это честнее,
     чем прыжки «то 449 ₽, то ноль». */
  function regularsWeeklyCost() {
    const s = get();
    const byId = productsById();
    let total = 0;
    const items = [];
    (s.regulars || []).forEach(function (r) {
      const prod = byId[r.p];
      if (!prod) return;
      const perWeek = r.qty / periodWeeks(r.per);
      const cost = perWeek * prod.pr;
      total += cost;
      items.push({ product: prod, perWeek: perWeek, cost: cost, raw: r });
    });
    return { total: total, items: items };
  }

  // ---------- ЭКСПОРТ / ИМПОРТ ----------

  function exportJson() {
    return JSON.stringify(get(), null, 2);
  }

  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !parsed.settings) throw new Error('Файл не похож на выгрузку этого приложения');
    state = migrate(parsed);
    save();
  }

  window.App = window.App || {};
  window.App.store = {
    load, save, get, reset, today,
    products, productsById, pricePerBase, isStale, daysSince, setPrice,
    recordPrice, priceHistory, brandsOf, effectivePrice, invalidate,
    recipes, allRecipes,
    pantryAdd, pantrySet,
    weeklyBudget, regularsWeeklyCost, PERIODS, periodWeeks,
    exportJson, importJson,
    defaultPerson
  };
})();
