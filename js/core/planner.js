/* Генератор недельного меню и подгонка его под бюджет.
 *
 * Логика в двух шагах:
 *  1. Собрать неделю так, чтобы закрыть калории и БЖУ, отдавая приоритет тому,
 *     что уже лежит в кладовой.
 *  2. Если получилось дороже бюджета — удешевлять, НЕ трогая калории и белок:
 *     сначала заменой продуктов на аналоги в той же роли (говядина → бедро → яйца),
 *     потом заменой самих блюд. Калории пересчитываются после каждой замены,
 *     поэтому «сэкономить, недокормив себя» приложение не умеет по построению.
 */
(function () {
  'use strict';

  const S = () => window.App.store;
  const N = () => window.App.nutrition;
  const SH = () => window.App.shopping;

  const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

  // Группы, внутри которых замена продукта осмысленна.
  // Специи, соусы и напитки не заменяем — экономии ноль, вкус ломается.
  // Базовые овощи (лук, морковь, капуста) тоже вне списка: они стоят копейки,
  // и «замена моркови на лук» экономит рубль, а блюдо делает несъедобным.
  const SWAPPABLE = ['prot_meat', 'prot_fish', 'prot_dairy', 'prot_legume', 'prot_egg',
    'carb_grain', 'carb_pasta', 'carb_potato', 'veg_fresh',
    'fat_oil', 'fat_butter', 'fat_dairy', 'fruit', 'dairy_liquid', 'bread', 'nuts'];

  // Замена принимается, только если экономит заметно: иначе оптимизатор
  // ради четырёх рублей перекраивает половину меню. Но когда разрыв с бюджетом
  // большой, привередничать нельзя — порог падает, а лимит замен растёт.
  const MIN_SAVING_RUB = 40;
  const MIN_SAVING_SHARE = 0.02;
  const MAX_SWAPS = 8;
  const URGENT_GAP_SHARE = 0.12;   // разрыв больше 12% стоимости — режим экономии

  /* Границы масштабирования порции.
   *
   * Нижняя граница была 0,35 — и это ломало день. Рецепт на четыре порции,
   * попавший в перекус, требует коэффициента около 0,2; упираясь в 0,35,
   * он выдавал 831 ккал вместо 444, и день уезжал на девять процентов вверх.
   * Планировщик при этом считал, что попал в норму.
   *
   * Ниже 0,2 не опускаемся уже по здравому смыслу: «пятая часть кастрюли»
   * ещё осмысленна, «двадцатая» — нет. Поэтому вторая половина решения —
   * штраф в подборе, чтобы блюда с неудобным масштабом просто реже попадали
   * в такие слоты. */
  const MULT_MIN = 0.2;
  const MULT_MAX = 3.2;
  const MULT_COMFORT_LOW = 0.4;
  const MULT_COMFORT_HIGH = 2.5;

  function swapThreshold(cost, gap) {
    const urgent = gap > cost * URGENT_GAP_SHARE;
    return {
      rub: urgent ? 20 : MIN_SAVING_RUB,
      share: urgent ? 0.004 : MIN_SAVING_SHARE,
      maxSwaps: urgent ? 14 : MAX_SWAPS
    };
  }

  // ---------------------------------------------------------------- утилиты

  function clone(recipe) {
    return Object.assign({}, recipe, { ing: recipe.ing.map(i => ({ p: i.p, g: i.g })) });
  }

  function edible(product) {
    return 1 - (product.wst || 0);
  }

  /* Во сколько обходится единица пользы от продукта: для белковых — рубль за грамм
     белка, для остального — рубль за килокалорию. По этой мере и идёт удешевление. */
  function unitCost(product, role) {
    const perBase = S().pricePerBase(product);
    const e = edible(product);
    if (role === 'protein') {
      const protPerBase = product.p / 100 * e;
      return protPerBase > 0.005 ? perBase / protPerBase : Infinity;
    }
    const kcalPerBase = product.k / 100 * e;
    return kcalPerBase > 0.01 ? perBase / kcalPerBase : perBase * 100;
  }

  function recipeCost(recipe, byId, mult) {
    return recipe.ing.reduce(function (sum, i) {
      const p = byId[i.p];
      return p ? sum + i.g * mult * S().pricePerBase(p) : sum;
    }, 0);
  }

  /* Сколько на самом деле стоит добавить это блюдо в план.
   *
   * Наивный подсчёт «граммы × цена за грамм» врёт вдвое: продукты продаются
   * упаковками, и если ради одного рецепта пришлось купить пачку риса 800 г,
   * а ушло 300 г, то следующее блюдо с рисом обойдётся бесплатно — оставшиеся
   * 500 г уже оплачены. Именно на этой разнице в тестах терялось от четверти
   * до половины недельного бюджета: план набирал три десятка разных продуктов,
   * каждый целой упаковкой, и почти всё оставалось недоеденным.
   *
   * Поэтому цена считается по остатку: сначала кладовая, потом уже оплаченные
   * хвосты упаковок, и только недостающее — новыми пачками.
   */
  function marginalCost(recipe, byId, ctx, mult) {
    let cost = 0;
    recipe.ing.forEach(function (i) {
      const product = byId[i.p];
      if (!product) return;

      let need = i.g * mult;
      need -= Math.min(need, ctx.pantry[i.p] || 0);

      const committed = ctx.committed[i.p];
      if (committed) need -= Math.min(need, Math.max(0, committed.bought - committed.used));
      if (need <= 0.5) return;

      if (product.w) {
        const step = SH().weighStep(product);
        cost += SH().roundUp(need, step) * S().pricePerBase(product);
      } else {
        cost += Math.ceil(need / product.pack) * product.pr;
      }
    });
    return cost;
  }

  /* Запоминаем, что уже куплено и сколько из этого израсходовано, — чтобы
     следующее блюдо видело оплаченные остатки. */
  function commitRecipe(recipe, byId, ctx, mult) {
    recipe.ing.forEach(function (i) {
      const product = byId[i.p];
      if (!product) return;

      let need = i.g * mult;
      const fromPantry = Math.min(need, ctx.pantry[i.p] || 0);
      if (fromPantry > 0) {
        ctx.pantry[i.p] -= fromPantry;
        if (ctx.pantry[i.p] < 1) delete ctx.pantry[i.p];
        need -= fromPantry;
      }
      if (need <= 0.5) return;

      const c = ctx.committed[i.p] || (ctx.committed[i.p] = { bought: 0, used: 0 });
      const free = Math.max(0, c.bought - c.used);
      const fromFree = Math.min(need, free);
      c.used += fromFree;
      need -= fromFree;
      if (need <= 0.5) return;

      const extra = product.w
        ? SH().roundUp(need, SH().weighStep(product))
        : Math.ceil(need / product.pack) * product.pack;
      c.bought += extra;
      c.used += need;
    });
  }

  /* Часть стоимости рецепта, которую можно покрыть из кладовой.
     Именно это заставляет приложение «доедать» то, что уже куплено. */
  function pantryCover(recipe, byId, pantry, mult) {
    let covered = 0, totalCost = 0;
    recipe.ing.forEach(function (i) {
      const p = byId[i.p];
      if (!p) return;
      const need = i.g * mult;
      const cost = need * S().pricePerBase(p);
      totalCost += cost;
      const have = Math.min(need, pantry[i.p] || 0);
      covered += have * S().pricePerBase(p);
    });
    return totalCost > 0 ? covered / totalCost : 0;
  }

  /* Во сколько раз рецепт придётся масштабировать под этот приём пищи.
     Нужна до общего пересчёта порций, чтобы правильно оценить закупку. */
  function estimateMult(recipe, byId, ctx, slot) {
    const nut = N().recipeNutrition(recipe, byId);
    const target = (ctx.slotTargets[slot] || { kcal: 600 }).kcal;
    return Math.max(MULT_MIN, Math.min(MULT_MAX, target / Math.max(1, nut.total.kcal)));
  }

  function consumePantry(pantry, recipe, mult) {
    recipe.ing.forEach(function (i) {
      const need = i.g * mult;
      if (!pantry[i.p]) return;
      pantry[i.p] = Math.max(0, pantry[i.p] - need);
      if (pantry[i.p] < 1) delete pantry[i.p];
    });
  }

  // ---------------------------------------------------------------- нормы

  /* Доли приёмов пищи одного человека, пересчитанные на его набор.
     Если он не завтракает, завтраковые калории расходятся по остальным
     приёмам, а не пропадают: суточная норма от этого не уменьшается. */
  function personShares(person) {
    const meals = window.App.MEALS;
    const active = (person.meals || []).filter(m => meals[m]);
    const sum = active.reduce((s, m) => s + meals[m].share, 0) || 1;
    const out = {};
    active.forEach(m => { out[m] = meals[m].share / sum; });
    return out;
  }

  /* Цель каждого приёма пищи в абсолютных величинах: складываем доли только
     тех, кто в этом приёме участвует. Поэтому если перекус нужен одному
     из двоих, порция считается на одного, а не на двоих. */
  function slotTargets(people) {
    const out = {};
    people.forEach(function (person) {
      const t = N().personTargets(person);
      const shares = personShares(person);
      Object.keys(shares).forEach(function (slot) {
        const bucket = out[slot] || (out[slot] = { kcal: 0, p: 0, f: 0, c: 0, eaters: [], byPerson: [] });
        bucket.kcal += t.kcal * shares[slot];
        bucket.p += t.p * shares[slot];
        bucket.f += t.f * shares[slot];
        bucket.c += t.c * shares[slot];
        bucket.eaters.push(person.name);
        // Личная доля нужна, чтобы разложить готовое блюдо по тарелкам:
        // общая цифра на двоих не говорит, кому сколько класть.
        bucket.byPerson.push({
          id: person.id,
          name: person.name,
          kcal: Math.round(t.kcal * shares[slot]),
          p: Math.round(t.p * shares[slot]),
          f: Math.round(t.f * shares[slot]),
          c: Math.round(t.c * shares[slot])
        });
      });
    });
    Object.keys(out).forEach(function (slot) {
      out[slot].kcal = Math.round(out[slot].kcal);
      out[slot].p = Math.round(out[slot].p);
      out[slot].f = Math.round(out[slot].f);
      out[slot].c = Math.round(out[slot].c);
    });
    return out;
  }

  /* Цели приёмов пищи для этого плана.
   *
   * План живёт в браузере неделями и переживает обновления приложения, поэтому
   * сохранённая структура может оказаться старее кода. Так и вышло с разбивкой
   * по людям: у планов, собранных до её появления, поля byPerson нет, и раскладка
   * «кому сколько класть» молча не показывалась — пользователю оставалось гадать,
   * почему обещанного нет. Требовать пересборки ради этого неправильно, поэтому
   * недостающее досчитывается на месте и записывается обратно в план. */
  function targetsOf(plan) {
    const stored = plan.slotTargets;
    const complete = stored && Object.keys(stored).length &&
      Object.keys(stored).every(k => stored[k] && stored[k].byPerson && stored[k].byPerson.length);
    if (complete) return stored;

    const fresh = slotTargets(S().get().people);
    if (plan.slotTargets !== fresh) plan.slotTargets = fresh;
    return fresh;
  }

  /* Все приёмы пищи, которые едят из одной кастрюли: день готовки и его
     «вчерашние» продолжения. */
  function potMeals(plan, dayIndex, slot) {
    const day = plan.days[dayIndex];
    const meal = day && day.meals.find(m => m.slot === slot);
    if (!meal) return [];

    const cookIndex = meal.leftoverOf != null ? meal.leftoverOf : dayIndex;
    const out = [];
    const cook = plan.days[cookIndex] && plan.days[cookIndex].meals.find(m => m.slot === slot);
    if (cook) out.push(cook);
    plan.days.forEach(function (d) {
      d.meals.forEach(function (m) {
        if (m.leftoverOf === cookIndex && m.slot === slot) out.push(m);
      });
    });
    return out;
  }

  /* Разложить правку состава на всю кастрюлю.
   *
   * Блюдо «на два дня» хранится двумя копиями — так у каждого дня своя порция.
   * Но кастрюля-то одна: если поправить состав в день готовки, второй день
   * обязан измениться вместе с ним. Без этого две копии расходятся, и второй
   * день показывает еду, которую никто не готовил. */
  function syncPot(plan, dayIndex, slot) {
    const meals = potMeals(plan, dayIndex, slot);
    if (meals.length < 2) return 0;

    const day = plan.days[dayIndex];
    const source = day && day.meals.find(m => m.slot === slot);
    if (!source || !source.recipe) return 0;

    let changed = 0;
    meals.forEach(function (m) {
      if (m === source || !m.recipe) return;
      m.recipe = Object.assign({}, source.recipe, {
        ing: source.recipe.ing.map(i => ({ p: i.p, g: i.g }))
      });
      changed++;
    });
    return changed;
  }

  /* Во что обходится один приём пищи.
   *
   * Не «граммы × цена с ценника»: так получается на 38% меньше того, что уходит
   * в кассе. Считаем по фактическим тратам — переплата за целые упаковки ложится
   * на те блюда, ради которых упаковка куплена, а взятое из кладовой на этой
   * неделе не стоит ничего. Сумма по всем приёмам пищи в точности равна итогу
   * списка покупок. */
  function mealCost(plan, meal) {
    if (!meal || !meal.recipe) return 0;
    const rates = SH().unitRates(plan);
    return meal.recipe.ing.reduce(function (sum, i) {
      return sum + i.g * meal.mult * (rates[i.p] || 0);
    }, 0);
  }

  function dayCost(plan, day) {
    return day.meals.reduce((sum, m) => sum + mealCost(plan, m), 0);
  }

  /* Разложить готовое блюдо по тарелкам.
   *
   * Готовим одно, а нормы у людей разные — значит и порции разные. Здесь
   * общий вес блюда делится в той же пропорции, в какой относятся личные
   * калорийные доли этого приёма пищи.
   *
   * Вес считается по съедобной части ингредиентов: кожура и обрезь до тарелки
   * не доходят. Для супов он всё равно занижен — вода в рецепте не указана,
   * поэтому в интерфейсе цифра подписана как приблизительная. */
  function mealPortions(plan, meal) {
    if (!meal || !meal.recipe) return [];
    const byId = S().productsById();
    const slot = (targetsOf(plan)[meal.slot]) || null;
    if (!slot || !slot.byPerson || !slot.byPerson.length) return [];

    const totalWeight = meal.recipe.ing.reduce(function (sum, i) {
      const p = byId[i.p];
      return p ? sum + i.g * meal.mult * (1 - (p.wst || 0)) : sum;
    }, 0);

    const nut = meal.nutrition || N().nutritionOf(
      meal.recipe.ing.map(i => ({ p: i.p, g: i.g * meal.mult })), byId);

    // Стоимость именно этой тарелки — по фактическим тратам, а не по ценнику.
    const total = mealCost(plan, meal);

    // Делим на сумму личных долей, а не на общую цифру приёма пищи: обе
    // округлены по отдельности, и от этого доли не складывались в единицу —
    // цена блюда расходилась с суммой по людям на пару рублей.
    const slotKcal = slot.byPerson.reduce((sum, x) => sum + x.kcal, 0) || 1;
    return slot.byPerson.map(function (person) {
      const share = person.kcal / slotKcal;
      return {
        name: person.name,
        share: share,
        grams: Math.round(totalWeight * share),
        kcal: Math.round((nut.kcal || 0) * share),
        p: Math.round((nut.p || 0) * share),
        f: Math.round((nut.f || 0) * share),
        c: Math.round((nut.c || 0) * share),
        cost: total * share
      };
    });
  }

  // ---------------------------------------------------------------- сборка

  /* Что уже стоит в этом дне: одно и то же блюдо на обед и на ужин —
     это не экономия, а надоедание, и такой повтор отличается от «то же самое,
     но завтра». Поэтому запрет на день действует независимо от того,
     сколько повторов за неделю человек себе разрешил. */
  function usedOnDay(day) {
    return day.meals.filter(m => m.recipe).map(m => m.recipe.id);
  }

  /* Блюда этого же дня, кроме самого заменяемого. Нужно там, где приём пищи
     меняют задним числом — ради белка или ради бюджета: эти замены выбирали
     блюдо по слоту, не глядя на остальной день, и возвращали дубль,
     который подбор только что аккуратно обошёл. */
  function otherDishesToday(plan, meal) {
    const day = plan.days[meal._day];
    if (!day) return [];
    return day.meals.filter(m => m !== meal && m.recipe).map(m => m.recipe.id);
  }

  function pickRecipe(slot, ctx, usedToday) {
    const { byId, pantry, usage, lastBySlot, settings } = ctx;
    const sameDay = usedToday || [];

    // Запрет «то же самое два дня подряд» нужен тем, кто хочет разнообразия.
    // Если человек сознательно поднял лимит повторов до 4 и выше, он готов есть
    // одно блюдо подряд — и запрет только мешает.
    const allowBackToBack = settings.maxRepeat >= 4;

    let candidates = ctx.recipes.filter(function (r) {
      if (r.m.indexOf(slot) === -1) return false;
      if (sameDay.indexOf(r.id) !== -1) return false;
      if ((usage[r.id] || 0) >= settings.maxRepeat) return false;
      if (!allowBackToBack && lastBySlot[slot] === r.id) return false;
      return true;
    });

    // Если фильтры срезали всё (мало рецептов после исключений) — ослабляем их
    // по одному, начиная с наименее важного. Запрет на повтор внутри дня
    // снимается последним: он заметнее всего портит впечатление от меню.
    if (!candidates.length) {
      candidates = ctx.recipes.filter(r => r.m.indexOf(slot) !== -1 && sameDay.indexOf(r.id) === -1);
    }
    if (!candidates.length) {
      candidates = ctx.recipes.filter(r => r.m.indexOf(slot) !== -1);
    }
    if (!candidates.length) return null;

    // Считаем цену за килокалорию по остатку упаковок: блюдо из продуктов,
    // которые в списке уже есть, обходится почти даром.
    const slotKcal = (ctx.slotTargets[slot] || { kcal: 600 }).kcal;
    const costs = candidates.map(function (r) {
      const nut = N().recipeNutrition(r, byId);
      const kcal = nut.total.kcal || 1;
      const mult = Math.max(0.35, Math.min(3.0, slotKcal / kcal));
      return marginalCost(r, byId, ctx, mult) / (kcal * mult);
    });
    const medianCost = costs.slice().sort((a, b) => a - b)[Math.floor(costs.length / 2)] || 1;

    const scored = candidates.map(function (r, idx) {
      let score = 0;
      score += pantryCover(r, byId, pantry, 1) * 1.5;      // доесть скоропорт из кладовой
      // Вес 5 выбран замером: перебор значений от 2,5 до 10 на восьми прогонах
      // дал здесь лучшую среднюю стоимость недели при сохранении разнообразия.
      // В режиме экономии цена перевешивает всё остальное.
      score -= (costs[idx] / (medianCost || 1)) * (ctx.costFocus ? 12.0 : 5.0);
      score -= (usage[r.id] || 0) * (ctx.costFocus ? 0.4 : 1.5);   // на жёстком бюджете повторы допустимы
      if (r.t > 50) score -= 0.4;                          // долгие рецепты реже

      // Блюдо, которое под этот приём пищи приходится сжимать впятеро или
      // растягивать втрое, здесь не к месту: даже уложившись в границы,
      // оно даёт неестественную порцию и уводит день от нормы.
      const fitNut = N().recipeNutrition(r, byId);
      const ideal = slotKcal / Math.max(1, fitNut.total.kcal);
      if (ideal < MULT_COMFORT_LOW) score -= (MULT_COMFORT_LOW - ideal) * 6;
      else if (ideal > MULT_COMFORT_HIGH) score -= (ideal - MULT_COMFORT_HIGH) * 1.5;

      if (ctx.proteinDeficit) {
        const nut = N().recipeNutrition(r, byId);
        score += Math.min(1.2, nut.total.p / Math.max(1, nut.total.kcal) * 60);
      }
      score += Math.random() * (ctx.costFocus ? 0.15 : 0.4);       // чтобы неделя не повторялась дословно
      return { r: r, score: score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(5, scored.length));
    const weights = top.map((_, i) => top.length - i);
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < top.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return top[i].r;
    }
    return top[0].r;
  }

  /* Пересчёт порций: каждое блюдо масштабируется так, чтобы попасть
     в калорийную долю своего приёма пищи. Вызывается после любой правки плана. */
  function rebalance(plan, byId) {
    const targets = targetsOf(plan);

    plan.days.forEach(function (day) {
      day.meals.forEach(function (meal) {
        if (!meal.recipe) return;
        const nut = N().recipeNutrition(meal.recipe, byId);
        const targetKcal = (targets[meal.slot] || { kcal: 0 }).kcal;
        const total = nut.total.kcal || 1;
        let mult = targetKcal / total;
        mult = Math.max(MULT_MIN, Math.min(MULT_MAX, mult));
        meal.mult = Math.round(mult * 100) / 100;
      });
    });

    // Блюда «на два дня»: закупаем на оба дня в день готовки, второй день не готовим.
    plan.days.forEach(function (day, di) {
      day.meals.forEach(function (meal) {
        if (!meal.recipe) return;
        if (meal.leftoverOf != null) { meal.buy = 0; return; }
        let buy = meal.mult;
        const next = plan.days[di + 1];
        if (next) {
          const twin = next.meals.find(m => m.leftoverOf === di && m.slot === meal.slot);
          if (twin) buy += twin.mult;
        }
        meal.buy = Math.round(buy * 100) / 100;
      });
    });

    recomputeNutrition(plan, byId);
  }

  function recomputeNutrition(plan, byId) {
    let week = { kcal: 0, p: 0, f: 0, c: 0 };
    plan.days.forEach(function (day) {
      const scaled = [];
      day.meals.forEach(function (meal) {
        if (!meal.recipe) return;
        meal.recipe.ing.forEach(i => scaled.push({ p: i.p, g: i.g * meal.mult }));
        meal.nutrition = N().nutritionOf(meal.recipe.ing.map(i => ({ p: i.p, g: i.g * meal.mult })), byId);
      });
      day.nutrition = N().nutritionOf(scaled, byId);
      week.kcal += day.nutrition.kcal;
      week.p += day.nutrition.p;
      week.f += day.nutrition.f;
      week.c += day.nutrition.c;
    });
    plan.nutrition = {
      week: {
        kcal: Math.round(week.kcal), p: Math.round(week.p),
        f: Math.round(week.f), c: Math.round(week.c)
      },
      avgDay: {
        kcal: Math.round(week.kcal / 7), p: Math.round(week.p / 7),
        f: Math.round(week.f / 7), c: Math.round(week.c / 7)
      }
    };
  }

  function buildSkeleton(settings, people) {
    const daily = N().householdTargets(people);
    const targets = slotTargets(people);
    // Порядок приёмов пищи — как в течение дня, а не как пришлось в объекте.
    const slots = Object.keys(window.App.MEALS).filter(s => targets[s]);
    const start = new Date((settings.startDay || S().today()) + 'T00:00:00');

    const days = [];
    for (let d = 0; d < 7; d++) {
      // Прибавляем календарный день, а не 24 часа: при переходе на летнее
      // время сутки длятся 23 или 25 часов, и арифметика по миллисекундам
      // рано или поздно промахивается мимо полуночи.
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
      days.push({
        date: S().localDate(date),
        name: DAY_NAMES[(date.getDay() + 6) % 7],
        meals: slots.map(slot => ({ slot: slot, recipe: null, mult: 1, buy: 1, leftoverOf: null }))
      });
    }

    return {
      createdAt: new Date().toISOString(),
      slotTargets: targets,
      slots: slots,
      targets: {
        daily: daily,
        week: { kcal: daily.kcal * 7, p: daily.p * 7, f: daily.f * 7, c: daily.c * 7 }
      },
      days: days,
      swaps: [],
      replacements: [],
      notes: []
    };
  }

  /* Рабочий контекст подбора: каталог, доступные рецепты, виртуальная кладовая
     (она пустеет по мере того, как блюда её «съедают») и счётчик повторов. */
  function makeCtx() {
    const state = S().get();
    return {
      byId: S().productsById(),
      recipes: S().recipes(),
      pantry: Object.assign({}, state.pantry),
      committed: {},                       // что уже оплачено упаковками и сколько из этого съедено
      slotTargets: slotTargets(state.people),
      usage: {},
      lastBySlot: {},
      settings: state.settings,
      proteinDeficit: false
    };
  }

  /* Слот мог опустеть после отмены блюда «на два дня». Пустая ячейка в меню —
     это молчаливо пропущенный приём пищи, поэтому дозаполняем всегда. */
  function refillEmpty(plan, ctx, byId) {
    let filled = 0;
    plan.days.forEach(function (day) {
      day.meals.forEach(function (meal) {
        if (meal.recipe) return;
        const recipe = pickRecipe(meal.slot, ctx, usedOnDay(day));
        if (!recipe) return;
        meal.recipe = clone(recipe);
        meal.leftoverOf = null;
        ctx.usage[recipe.id] = (ctx.usage[recipe.id] || 0) + 1;
        commitRecipe(recipe, byId, ctx, estimateMult(recipe, byId, ctx, meal.slot));
        filled++;
      });
    });
    if (filled) rebalance(plan, byId);
    return filled;
  }

  function generate(opts) {
    const state = S().get();
    const settings = state.settings;
    const ctx = makeCtx();
    const byId = ctx.byId;
    // Режим экономии: цена перевешивает разнообразие, а состав макронутриентов
    // сдвигается к дешёвым калориям. Включается только жёсткой подгонкой.
    ctx.costFocus = !!(opts && opts.costFocus);

    const plan = buildSkeleton(settings, state.people);

    plan.days.forEach(function (day, di) {
      day.meals.forEach(function (meal) {
        // День уже занят вчерашней готовкой — ничего не выбираем.
        if (meal.recipe) return;

        const recipe = pickRecipe(meal.slot, ctx, usedOnDay(day));
        if (!recipe) return;

        const mult = estimateMult(recipe, byId, ctx, meal.slot);
        meal.recipe = clone(recipe);
        ctx.usage[recipe.id] = (ctx.usage[recipe.id] || 0) + 1;
        ctx.lastBySlot[meal.slot] = recipe.id;
        commitRecipe(recipe, byId, ctx, mult);

        // Суп или рагу логично съесть за два дня — так дешевле и меньше готовки.
        if (settings.batchTwoDays && recipe.batch && plan.days[di + 1]) {
          const twin = plan.days[di + 1].meals.find(m => m.slot === meal.slot && !m.recipe);
          if (twin) {
            twin.recipe = clone(recipe);
            twin.leftoverOf = di;
            ctx.usage[recipe.id] = (ctx.usage[recipe.id] || 0) + 1;
            commitRecipe(recipe, byId, ctx, mult); // второй день закупается тем же заходом
          }
        }
      });
    });

    rebalance(plan, byId);
    refillEmpty(plan, ctx, byId);
    fixProtein(plan, byId, ctx);
    tuneMacros(plan, byId);
    if (ctx.costFocus) tuneForCost(plan, byId, settings.proteinFloor);
    fitToBudget(plan, byId, ctx);
    return plan;
  }

  /* Обменять белок на углеводы при тех же калориях.
   *
   * Само по себе снижение порога белка почти ничего не даёт: порог — это
   * запрет, а не цель, и планировщик всё равно набирает 100% нормы. Экономия
   * появляется, только если рацион сознательно сдвинуть к дешёвым калориям:
   * грамм белка из мяса стоит в разы дороже грамма углеводов из крупы.
   * Опускаемся ровно до разрешённой границы и ни граммом ниже. */
  function tuneForCost(plan, byId, floorRatio) {
    for (let step = 0; step < 10; step++) {
      const w = plan.nutrition.week, t = plan.targets.week;
      if (w.p <= t.p * (floorRatio + 0.02)) return;

      const snap = snapshot(plan);
      plan.days.forEach(function (day) {
        day.meals.forEach(function (meal) {
          if (!meal.recipe) return;
          meal.recipe.ing.forEach(function (i) {
            const p = byId[i.p];
            if (!p) return;
            if (p.role === 'protein' && i.g > 20) i.g = Math.round(i.g * 0.92);
            else if (p.role === 'carb') i.g = Math.round(i.g * 1.06);
          });
        });
      });
      rebalance(plan, byId);

      if (plan.nutrition.week.p < t.p * floorRatio) {
        restore(plan, snap);
        rebalance(plan, byId);
        return;
      }
    }
  }

  /* Калории после rebalance всегда попадают в цель, а вот их состав — нет:
     набор блюд может дать перекос в жиры при нехватке углеводов. Здесь мы
     двигаем пропорции внутри блюд (больше крупы, меньше масла), не трогая
     ни калорийность, ни белок. */
  function macroError(plan) {
    const w = plan.nutrition.week, t = plan.targets.week;
    return Math.abs(w.c / t.c - 1) + Math.abs(w.f / t.f - 1);
  }

  function tuneMacros(plan, byId) {
    const floor = S().get().settings.proteinFloor;

    for (let step = 0; step < 8; step++) {
      const w = plan.nutrition.week, t = plan.targets.week;
      const errorBefore = macroError(plan);
      if (errorBefore < 0.10) return;           // уже достаточно ровно

      const carbLow = w.c < t.c;
      const fatHigh = w.f > t.f;
      if (!carbLow && !fatHigh) return;

      const snap = snapshot(plan);
      const proteinBefore = w.p;

      // Шаг намеренно мелкий: крупный проскакивает цель и загоняет перекос
      // в противоположную сторону.
      plan.days.forEach(function (day) {
        day.meals.forEach(function (meal) {
          if (!meal.recipe) return;
          meal.recipe.ing.forEach(function (i) {
            const p = byId[i.p];
            if (!p) return;
            if (carbLow && p.role === 'carb') i.g = Math.round(i.g * 1.07);
            // Масло ниже 8 г на блюдо не опускаем — на таком не пожаришь.
            if (fatHigh && p.role === 'fat' && i.g > 8) i.g = Math.max(8, Math.round(i.g * 0.94));
          });
        });
      });
      rebalance(plan, byId);

      const proteinAfter = plan.nutrition.week.p;
      // Белком за баланс не платим. Сравниваем с тем, что было до шага, а не
      // просто с порогом: если белок и так лежал на границе, шаг, который его
      // не ухудшил, откатывать не за что.
      const proteinLost = proteinAfter < t.p * floor && proteinAfter < proteinBefore;

      if (proteinLost || macroError(plan) >= errorBefore) {
        restore(plan, snap);
        rebalance(plan, byId);
        return;
      }
    }
  }

  /* Если по неделе не добираем белок — меняем самые «пустые» блюда на белковые. */
  function fixProtein(plan, byId, ctx) {
    const settings = S().get().settings;
    // Целимся чуть выше жёсткой границы: она нужна оптимизатору как «ниже нельзя»,
    // а сборке меню — как «хорошо бы с запасом».
    const aim = Math.min(1, settings.proteinFloor + 0.05);
    let guard = 0;
    while (plan.nutrition.week.p < plan.targets.week.p * aim && guard++ < 10) {
      const meals = allMeals(plan).filter(m => m.recipe && m.leftoverOf == null);
      if (!meals.length) break;

      meals.sort(function (a, b) {
        const da = a.nutrition.p / Math.max(1, a.nutrition.kcal);
        const db = b.nutrition.p / Math.max(1, b.nutrition.kcal);
        return da - db;
      });
      const worst = meals[0];

      const busyToday = otherDishesToday(plan, worst);
      const better = ctx.recipes
        .filter(r => r.m.indexOf(worst.slot) !== -1 && r.id !== worst.recipe.id &&
          busyToday.indexOf(r.id) === -1)
        .map(function (r) {
          const nut = N().recipeNutrition(r, byId);
          return { r: r, density: nut.total.p / Math.max(1, nut.total.kcal) };
        })
        .sort((a, b) => b.density - a.density)[0];

      if (!better) break;
      const currentDensity = worst.nutrition.p / Math.max(1, worst.nutrition.kcal);
      if (better.density <= currentDensity) break;

      clearLeftovers(plan, worst);
      worst.recipe = clone(better.r);
      plan.replacements.push({ reason: 'protein', to: better.r.n });
      rebalance(plan, byId);
      refillEmpty(plan, ctx, byId);
    }
  }

  function allMeals(plan) {
    const out = [];
    plan.days.forEach((d, di) => d.meals.forEach(m => { m._day = di; out.push(m); }));
    return out;
  }

  /* Если у блюда был «второй день», при замене его нужно снять. */
  function clearLeftovers(plan, meal) {
    plan.days.forEach(function (day) {
      day.meals.forEach(function (m) {
        if (m.leftoverOf === meal._day && m.slot === meal.slot) {
          m.recipe = null;
          m.leftoverOf = null;
        }
      });
    });
  }

  // ---------------------------------------------------------------- бюджет

  function budgetLimit() {
    const b = S().weeklyBudget();
    const settings = S().get().settings;
    return { food: b.food, allowed: b.food * (1 + settings.overspend), breakdown: b };
  }

  /* Кандидаты на замену продукта: та же роль, дешевле за единицу пользы. */
  function swapCandidates(product, byId) {
    if (!product.grp || SWAPPABLE.indexOf(product.grp) === -1) return [];
    const excluded = S().get().excluded;
    const role = product.role;
    const base = unitCost(product, role);

    return S().products()
      // Диета запрещает не только блюда, но и подстановку продукта в замену:
      // иначе оптимизатор вернул бы копчёности в щадящее меню через чёрный ход.
      .filter(p => p.grp === product.grp && p.id !== product.id && !excluded[p.id] &&
        S().isProductAllowed(p))
      .map(p => ({ p: p, cost: unitCost(p, role) }))
      .filter(c => c.cost < base * 0.95 && isFinite(c.cost))
      .sort((a, b) => a.cost - b.cost);
  }

  /* Сколько граммов заменителя даёт ту же пользу, что и грамм оригинала. */
  function equivalentGrams(from, to, grams) {
    const key = from.role === 'protein' ? 'p' : 'k';
    const fromDensity = from[key] / 100 * edible(from);
    const toDensity = to[key] / 100 * edible(to);
    if (fromDensity <= 0 || toDensity <= 0) return grams;
    const scaled = grams * (fromDensity / toDensity);
    return Math.max(grams * 0.3, Math.min(grams * 3, Math.round(scaled)));
  }

  function applySwap(plan, fromId, toId, byId) {
    const from = byId[fromId], to = byId[toId];
    let touched = 0;
    plan.days.forEach(function (day) {
      day.meals.forEach(function (meal) {
        if (!meal.recipe) return;
        const idx = meal.recipe.ing.findIndex(i => i.p === fromId);
        if (idx === -1) return;
        const grams = equivalentGrams(from, to, meal.recipe.ing[idx].g);
        const existing = meal.recipe.ing.findIndex(i => i.p === toId);
        if (existing !== -1 && existing !== idx) {
          meal.recipe.ing[existing].g += grams;
          meal.recipe.ing.splice(idx, 1);
        } else {
          meal.recipe.ing[idx] = { p: toId, g: grams };
        }
        touched++;
      });
    });
    return touched;
  }

  function snapshot(plan) {
    return JSON.stringify(plan.days);
  }

  function restore(plan, snap) {
    plan.days = JSON.parse(snap);
  }

  /* Найти приём пищи по координатам, а не по сохранённой ссылке.
   *
   * restore() заменяет plan.days разобранной копией, и все ссылки на приёмы
   * пищи, взятые до отката, указывают на объекты, которых в плане больше нет.
   * Править их можно сколько угодно — на план это не влияет. Поэтому там, где
   * между обращениями к приёму пищи возможен откат, его положение хранится
   * парой «день + слот», а сам объект берётся заново. */
  function mealAt(plan, dayIndex, slot) {
    const day = plan.days[dayIndex];
    return day ? day.meals.find(m => m.slot === slot) || null : null;
  }

  /* Проверка, что удешевление не сломало рацион. */
  function isAcceptable(plan) {
    const s = S().get().settings;
    const w = plan.nutrition.week, t = plan.targets.week;
    if (w.p < t.p * s.proteinFloor) return false;
    if (w.f < t.f * 0.65 || w.f > t.f * 1.30) return false;
    if (w.c < t.c * 0.80) return false;
    if (Math.abs(w.kcal - t.kcal) / t.kcal > s.kcalTolerance) return false;
    return true;
  }

  /* Дешёвый продукт — не повод есть его вёдрами. Потолок задан в каталоге
     полем maxWeek и считается на человека в неделю. */
  function withinWeeklyLimit(plan, productId, byId) {
    const product = byId[productId];
    if (!product || !product.maxWeek) return true;
    const eaters = Math.max(1, S().get().people.length);
    const need = SH().aggregate(plan)[productId] || 0;
    return need <= product.maxWeek * eaters * 1.15;
  }

  /* Сколько всего тратится на каждый продукт в плане — по этому списку
     ищем, что удешевлять в первую очередь. */
  function spendByProduct(plan, byId) {
    const spend = {};
    plan.days.forEach(function (day) {
      day.meals.forEach(function (meal) {
        if (!meal.recipe) return;
        const mult = meal.leftoverOf != null ? 0 : (meal.buy != null ? meal.buy : meal.mult);
        meal.recipe.ing.forEach(function (i) {
          const p = byId[i.p];
          if (!p) return;
          spend[i.p] = (spend[i.p] || 0) + i.g * mult * S().pricePerBase(p);
        });
      });
    });
    return spend;
  }

  function fitToBudget(plan, byId, ctx) {
    ctx = ctx || makeCtx();
    byId = byId || ctx.byId;
    const limit = budgetLimit();
    plan.budget = limit;

    // Подгонку можно запускать повторно (кнопкой на экране недели), поэтому
    // выводы прошлого запуска стираем: иначе они копятся и экран превращается
    // в простыню из одинаковых абзацев.
    plan.notes = [];

    let cost = SH().costOf(plan);
    plan.cost = cost;
    if (cost <= limit.allowed) return plan;

    const triedSwaps = {};
    let guard = 0;

    // Шаг 1: замена продуктов на более дешёвые аналоги той же роли.
    let bar = swapThreshold(cost, cost - limit.allowed);
    while (cost > limit.allowed && plan.swaps.length < bar.maxSwaps && guard++ < 60) {
      bar = swapThreshold(cost, cost - limit.allowed);
      const spend = spendByProduct(plan, byId);
      const ranked = Object.keys(spend)
        .map(id => ({ id: id, spend: spend[id] }))
        .sort((a, b) => b.spend - a.spend);

      let improved = false;
      for (const entry of ranked) {
        const product = byId[entry.id];
        if (!product) continue;
        const candidates = swapCandidates(product, byId).filter(c => !triedSwaps[entry.id + '>' + c.p.id]);
        if (!candidates.length) continue;

        const candidate = candidates[0];
        triedSwaps[entry.id + '>' + candidate.p.id] = true;

        const snap = snapshot(plan);
        applySwap(plan, entry.id, candidate.p.id, byId);
        rebalance(plan, byId);
        const newCost = SH().costOf(plan);
        const saving = cost - newCost;
        const worthIt = saving >= bar.rub && saving >= cost * bar.share;

        if (worthIt && isAcceptable(plan) && withinWeeklyLimit(plan, candidate.p.id, byId)) {
          // При повторной подгонке та же пара может всплыть снова — не плодим
          // строку, а суммируем экономию к уже записанной.
          const known = plan.swaps.find(s => s.from === product.n && s.to === candidate.p.n);
          if (known) known.saved += Math.round(saving);
          else plan.swaps.push({ from: product.n, to: candidate.p.n, saved: Math.round(saving) });
          cost = newCost;
          improved = true;
          break;
        }
        restore(plan, snap);
        rebalance(plan, byId);
      }
      if (!improved) break;
    }

    // Шаг 2: если замен продуктов не хватило — меняем сами блюда на более дешёвые.
    const recipes = S().recipes();
    guard = 0;
    while (cost > limit.allowed && guard++ < 20) {
      // Координаты, а не ссылки: внутри цикла случаются откаты, после которых
      // ссылка на приём пищи перестаёт быть частью плана.
      const spots = allMeals(plan)
        .filter(m => m.recipe && m.leftoverOf == null)
        .map(m => ({ day: m._day, slot: m.slot, meal: m }));
      spots.sort(function (a, b) {
        const ca = recipeCost(a.meal.recipe, byId, a.meal.buy || a.meal.mult) / Math.max(1, a.meal.nutrition.kcal);
        const cb = recipeCost(b.meal.recipe, byId, b.meal.buy || b.meal.mult) / Math.max(1, b.meal.nutrition.kcal);
        return cb - ca;
      });

      let improved = false;
      for (const spot of spots) {
        const current = mealAt(plan, spot.day, spot.slot);
        if (!current || !current.recipe) continue;

        const busyToday = otherDishesToday(plan, current);
        const alternatives = recipes
          .filter(r => r.m.indexOf(current.slot) !== -1 && r.id !== current.recipe.id &&
            busyToday.indexOf(r.id) === -1)
          .map(function (r) {
            const nut = N().recipeNutrition(r, byId);
            return { r: r, perKcal: recipeCost(r, byId, 1) / Math.max(1, nut.total.kcal) };
          })
          .sort((a, b) => a.perKcal - b.perKcal)
          .slice(0, 5);

        for (const alt of alternatives) {
          const snap = snapshot(plan);
          // Свежая ссылка на каждом обороте: предыдущий откат мог заменить её.
          const meal = mealAt(plan, spot.day, spot.slot);
          if (!meal || !meal.recipe) break;
          const removed = meal.recipe.n;

          meal._day = spot.day;
          clearLeftovers(plan, meal);
          meal.recipe = clone(alt.r);
          rebalance(plan, byId);
          refillEmpty(plan, ctx, byId);
          const newCost = SH().costOf(plan);
          if (newCost < cost - swapThreshold(cost, cost - limit.allowed).rub && isAcceptable(plan)) {
            plan.replacements.push({ reason: 'budget', from: removed, to: alt.r.n, saved: Math.round(cost - newCost) });
            cost = newCost;
            improved = true;
            break;
          }
          restore(plan, snap);
          rebalance(plan, byId);
        }
        if (improved) break;
      }
      if (!improved) break;
    }

    plan.cost = cost;
    if (cost > limit.allowed) {
      const gapWeek = Math.round(cost - limit.allowed);
      const s = S().get().settings;
      const weeks = s.period === 'month' ? s.weeksInMonth : 1;
      const needBudget = Math.round((s.budget + gapWeek * weeks) / 100) * 100;

      plan.notes.push('Уложиться в бюджет без потери нормы БЖУ не получилось: не хватает ' +
        gapWeek + ' ₽ в неделю. Показан самый дешёвый вариант, который сохраняет калории и белок — ' +
        'резать их приложение не станет.');
      plan.notes.push('Выхода три: поднять бюджет примерно до ' + needBudget + ' ₽ на ' +
        (s.period === 'month' ? 'месяц' : 'неделю') + '; занести в кладовую то, что уже есть дома; ' +
        'или пересмотреть цели в профилях — при снижении веса норма калорий, а с ней и стоимость, падает.');
    }
    return plan;
  }

  /* Жёсткая подгонка «во что бы то ни стало».
   *
   * Обычная подгонка отказывается резать белок ниже установленного порога —
   * и это правильное поведение по умолчанию. Но иногда денег просто нет,
   * и человек сознательно готов на компромисс. Тогда ограничения снимаются
   * ступенями, от самых безобидных к болезненным, и подгонка останавливается
   * на первой ступени, где план влез в бюджет.
   *
   * Чего эта функция не делает никогда: не опускает белок ниже 0,8 г на кг
   * массы тела и калории ниже 1200 у женщин и 1500 у мужчин. Это не настройка
   * бюджета, а граница, за которой начинается вред здоровью, поэтому вместо
   * красивой цифры приложение честно скажет, что уложиться нельзя.
   */
  function hardFit(plan) {
    const state = S().get();
    const settings = state.settings;
    const ctx = makeCtx();
    const byId = ctx.byId;
    const limit = budgetLimit();

    const original = { proteinFloor: settings.proteinFloor, maxRepeat: settings.maxRepeat };
    plan.compromises = [];

    // Снимок плана «по норме» — чтобы к нему можно было вернуться одной кнопкой.
    // Компромисс должен быть обратимым: человек соглашается на него ради денег,
    // а не навсегда.
    if (!plan.beforeHardFit) {
      plan.beforeHardFit = {
        days: JSON.parse(JSON.stringify(plan.days)),
        slotTargets: plan.slotTargets,
        targets: plan.targets,
        nutrition: plan.nutrition,
        swaps: plan.swaps,
        replacements: plan.replacements,
        notes: plan.notes,
        cost: plan.cost,
        budget: plan.budget
      };
    }

    // Абсолютный минимум белка: 0,8 г/кг — рекомендуемая норма ВОЗ,
    // ниже неё начинается потеря мышц, а не экономия.
    const safeProteinWeek = state.people.reduce((sum, p) => sum + p.weight * 0.8, 0) * 7;
    const floorRatio = Math.max(0.5, Math.min(0.9, safeProteinWeek / Math.max(1, plan.targets.week.p)));

    const stages = [
      { floor: original.proteinFloor, repeat: Math.max(original.maxRepeat, 3) },
      { floor: 0.85, repeat: Math.max(original.maxRepeat, 4) },
      { floor: 0.80, repeat: 5 },
      { floor: floorRatio, repeat: 7 }
    ];

    // Подбор блюд случаен, поэтому один прогон ничего не доказывает: берём
    // несколько попыток и оставляем самую дешёвую. Иначе жёсткая подгонка
    // иногда выдавала результат хуже исходного плана.
    const ATTEMPTS = 3;
    let best = null;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      if (stage.floor < floorRatio) continue;              // ниже безопасного не опускаемся

      settings.proteinFloor = stage.floor;
      settings.maxRepeat = stage.repeat;

      for (let a = 0; a < ATTEMPTS; a++) {
        // Пересобираем с нуля в режиме экономии: на жёстком бюджете важен сам
        // набор блюд, а не косметические замены в уже собранном меню.
        const attempt = generate({ costFocus: true });
        if (!best || attempt.cost < best.cost) best = attempt;
        if (best.cost <= limit.allowed) break;
      }
      if (best && best.cost <= limit.allowed) break;
    }

    settings.proteinFloor = original.proteinFloor;
    settings.maxRepeat = original.maxRepeat;

    // Если ослабление не помогло, исходный план всё равно не портим.
    if (best && best.cost < plan.cost) {
      plan.days = best.days;
      plan.slotTargets = best.slotTargets;
      plan.targets = best.targets;
      plan.nutrition = best.nutrition;
      plan.swaps = best.swaps;
      plan.replacements = best.replacements;
      plan.notes = best.notes;
      plan.cost = best.cost;
      plan.budget = best.budget;
    }

    const fitted = plan.cost <= limit.allowed;
    const w = plan.nutrition.week, t = plan.targets.week;
    const proteinShare = Math.round(w.p / t.p * 100);

    // Доля от цели пугает сильнее, чем есть на деле: цель 1,5 г/кг, а нижняя
    // безопасная граница 0,8 г/кг — это и есть 53% от цели. Поэтому показываем
    // ещё и граммы на килограмм, по ним видно реальное положение дел.
    const totalWeight = state.people.reduce((sum, p) => sum + p.weight, 0) || 1;
    const proteinPerKg = Math.round(w.p / 7 / totalWeight * 100) / 100;
    const targetPerKg = Math.round(t.p / 7 / totalWeight * 100) / 100;

    // Отчитываемся по тому, что получилось на самом деле, а не по названию
    // ступени, до которой дошли: иначе сообщение врёт.
    if (proteinShare < 97) {
      plan.compromises.push('белок снижен с ' + targetPerKg + ' до ' + proteinPerKg +
        ' г на кг веса (' + proteinShare + '% вашей цели)');
    }

    // Считаем повторы по готовому меню, а не по настройке: настройка к этому
    // моменту уже возвращена к исходной и сказала бы неправду.
    const used = {};
    allMeals(plan).forEach(function (m) {
      if (m.recipe) used[m.recipe.id] = (used[m.recipe.id] || 0) + 1;
    });
    const mostRepeated = Object.keys(used).reduce((n, k) => Math.max(n, used[k]), 0);
    if (mostRepeated > original.maxRepeat) {
      plan.compromises.push('одно блюдо повторяется до ' + mostRepeated + ' раз за неделю вместо ' + original.maxRepeat);
    }
    if (Math.round(w.c / t.c * 100) > 105) {
      plan.compromises.push('рацион сдвинут к крупам и хлебу — это самые дешёвые калории');
    }

    plan.hardFit = {
      fitted: fitted,
      cost: plan.cost,
      limit: Math.round(limit.allowed),
      proteinShare: proteinShare,
      proteinPerKg: proteinPerKg,
      targetPerKg: targetPerKg,
      safePerKg: 0.8,
      kcalShare: Math.round(w.kcal / t.kcal * 100),
      compromises: plan.compromises
    };

    if (!fitted) {
      plan.notes = plan.notes || [];
      plan.notes.push('Даже с ослабленными требованиями план не влезает: не хватает ' +
        Math.round(plan.cost - limit.allowed) + ' ₽ в неделю. Дальше резать нельзя — ' +
        'белок уже на нижней безопасной границе 0,8 г на кг веса. Это не ограничение ' +
        'приложения, а арифметика: столько еды за эти деньги в ваших магазинах не купить.');
    }

    S().save();
    return plan;
  }

  /* Вернуться к плану, собранному по полной норме БЖУ. */
  function undoHardFit(plan) {
    const snap = plan.beforeHardFit;
    if (!snap) return plan;

    plan.days = snap.days;
    plan.slotTargets = snap.slotTargets;
    plan.targets = snap.targets;
    plan.nutrition = snap.nutrition;
    plan.swaps = snap.swaps;
    plan.replacements = snap.replacements;
    plan.notes = snap.notes;
    plan.cost = snap.cost;
    plan.budget = snap.budget;

    delete plan.beforeHardFit;
    delete plan.hardFit;
    delete plan.compromises;

    S().save();
    return plan;
  }

  /* Разбор перерасхода: на чём именно ушли деньги и чем это заменить.
   *
   * Красной цифры «не хватает 149 ₽» мало — она говорит, что всё плохо,
   * но не говорит, что делать. Здесь по каждому дорогому продукту подбирается
   * несколько замен той же роли с оценкой экономии, а человек решает сам:
   * применить, выбрать другую замену или убрать предложение навсегда,
   * если оно ему не подходит.
   */
  /* Сколько замена сэкономит на самом деле.
   *
   * Прикидка по цене грамма белка врёт: продукты продаются упаковками,
   * и переход на более дешёвый за килограмм продукт может потребовать новую
   * пачку и выйти дороже. В тестах предложенная замена именно так и увеличила
   * стоимость недели. Поэтому здесь замена реально применяется к копии плана,
   * стоимость пересчитывается по упаковкам, и план возвращается на место. */
  function trySwapSaving(plan, fromId, toId, byId) {
    const snap = snapshot(plan);
    const before = plan.cost || SH().costOf(plan);
    applySwap(plan, fromId, toId, byId);
    rebalance(plan, byId);
    const after = SH().costOf(plan);
    const acceptable = isAcceptable(plan);
    restore(plan, snap);
    rebalance(plan, byId);
    return acceptable ? Math.round(before - after) : 0;
  }

  // Разбор вызывается на каждой перерисовке, а проба стоит недёшево.
  // Пока план и список отказов не менялись, отдаём готовый результат.
  let adviceCache = null;

  function overspendAdvice(plan, actualSpend) {
    const byId = S().productsById();
    const state = S().get();
    const limit = plan.budget ? plan.budget.food : budgetLimit().food;
    const spent = actualSpend != null ? actualSpend : plan.cost;
    const dismissed = state.dismissedSwaps || {};

    const key = [plan.cost, Object.keys(dismissed).length, Math.round(limit), Math.round(spent)].join('|');
    if (adviceCache && adviceCache.key === key) {
      return Object.assign({}, adviceCache.value, { over: Math.round(spent - limit) });
    }

    const spend = spendByProduct(plan, byId);
    const ideas = [];

    Object.keys(spend).forEach(function (id) {
      const product = byId[id];
      if (!product || spend[id] < 40) return;

      const base = unitCost(product, product.role);
      if (!isFinite(base) || base <= 0) return;

      const options = swapCandidates(product, byId)
        .filter(c => !dismissed[id + '>' + c.p.id])
        .slice(0, 3)                                  // проба недешёвая, перебирать всё незачем
        .map(function (c) {
          return { id: c.p.id, name: c.p.n, saves: trySwapSaving(plan, id, c.p.id, byId) };
        })
        .filter(o => o.saves >= 25)
        .sort((a, b) => b.saves - a.saves);

      if (!options.length) return;
      ideas.push({
        id: id,
        name: product.n,
        spend: Math.round(spend[id]),
        options: options
      });
    });

    ideas.sort((a, b) => b.options[0].saves - a.options[0].saves);

    const value = {
      spent: Math.round(spent),
      limit: Math.round(limit),
      ideas: ideas.slice(0, 6)
    };
    adviceCache = { key: key, value: value };

    return Object.assign({ over: Math.round(spent - limit) }, value);
  }

  /* Применить одну замену из разбора. Возвращает, сколько реально сэкономили —
     оценка и факт расходятся из-за целых упаковок. */
  function applyProductSwap(plan, fromId, toId) {
    const ctx = makeCtx();
    const byId = ctx.byId;
    const from = byId[fromId], to = byId[toId];
    if (!from || !to) return 0;

    const before = plan.cost || SH().costOf(plan);
    const snap = snapshot(plan);

    applySwap(plan, fromId, toId, byId);
    rebalance(plan, byId);
    refillEmpty(plan, ctx, byId);
    plan.cost = SH().costOf(plan);

    // Последняя проверка перед тем, как оставить изменение: даже проверенная
    // проба могла разойтись с итогом, а делать хуже по нажатию «Заменить»
    // приложение не имеет права.
    if (plan.cost >= before || !isAcceptable(plan)) {
      restore(plan, snap);
      rebalance(plan, byId);
      plan.cost = before;
      S().save();
      return 0;
    }

    const saved = Math.round(before - plan.cost);
    plan.swaps = plan.swaps || [];
    const known = plan.swaps.find(s => s.from === from.n && s.to === to.n);
    if (known) known.saved += saved;
    else plan.swaps.push({ from: from.n, to: to.n, saved: saved });

    S().save();
    return saved;
  }

  /* Если бюджет остался — куда его осмысленно потратить.
     Ничего не меняем автоматически: это предложения, решает человек. */
  function upgradeSuggestions(plan) {
    const byId = S().productsById();
    const limit = plan.budget || budgetLimit();
    const surplus = limit.allowed - plan.cost;
    if (surplus < 150) return [];

    const spend = spendByProduct(plan, byId);
    const out = [];

    Object.keys(spend).forEach(function (id) {
      const product = byId[id];
      if (!product || !product.grp || SWAPPABLE.indexOf(product.grp) === -1) return;
      const role = product.role;
      const base = unitCost(product, role);

      S().products()
        .filter(p => p.grp === product.grp && p.id !== id && unitCost(p, role) > base)
        .forEach(function (p) {
          const extra = (unitCost(p, role) - base) * (spend[id] / base);
          if (extra > 0 && extra < surplus) {
            out.push({ from: product.n, to: p.n, extra: Math.round(extra) });
          }
        });
    });

    // Разнообразие важнее одного дорогого продукта — берём по одной идее на группу.
    const seen = {};
    return out.sort((a, b) => a.extra - b.extra).filter(function (s) {
      if (seen[s.from]) return false;
      seen[s.from] = true;
      return true;
    }).slice(0, 5);
  }

  window.App = window.App || {};
  window.App.planner = {
    generate, rebalance, fitToBudget, hardFit, undoHardFit, budgetLimit, makeCtx, refillEmpty, tuneMacros,
    slotTargets, targetsOf, personShares, mealPortions, mealCost, dayCost, potMeals, syncPot,
    overspendAdvice, applyProductSwap,
    upgradeSuggestions, recipeCost, unitCost, allMeals,
    DAY_NAMES: DAY_NAMES
  };
})();
