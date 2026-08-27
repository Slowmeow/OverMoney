/* Состояние приложения: настройки, профили, кладовая, цены, планы.
 * Всё хранится локально в браузере. Никаких серверов и аккаунтов. */
(function () {
  'use strict';

  const KEY = 'spendings.v1';

  /* Дата в виде ГГГГ-ММ-ДД по местному календарю.
   *
   * Через toISOString() так делать нельзя, хотя соблазнительно коротко:
   * он переводит время в UTC, а Россия вся к востоку от него. Полночь 27-го
   * в Москве — это 26-е 21:00 по UTC, поэтому toISOString отдавал вчерашний
   * день. В журнале цен это ставило чекам вчерашнюю дату каждую ночь
   * до трёх часов, а в плане недели расходилось с названием дня:
   * строка «Четверг» несла в себе дату среды. */
  function localDate(date) {
    const d = date || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function today() {
    return localDate();
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
      // Диетические режимы: гастрит, непереносимости и прочее.
      diets: [],
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
      // Замены, которые человек отклонил: предлагать их снова — навязчиво.
      dismissedSwaps: {},  // {'откуда>куда': true}
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
  // Растёт при каждой записи. По нему кеши понимают, что состояние изменилось,
  // даже если сумма плана осталась прежней — например, поменялась кладовая.
  let revision = 0;

  /* Умеет ли браузер вообще что-то запомнить.
   *
   * Проверять надо записью, а не наличием localStorage: объект есть почти
   * везде, а работает он не везде. Файл, открытый прямо из мессенджера,
   * попадает в браузер по адресу content:// или file://, и для таких страниц
   * браузер хранилища не даёт — либо запрещает запись, либо стирает её при
   * закрытии вкладки. То же самое в режиме инкогнито при переполнении.
   *
   * Промолчать здесь нельзя. Приложение выглядело бы полностью рабочим:
   * неделя собирается, цены правятся, кладовая заполняется — а после
   * закрытия вкладки от всего этого не остаётся ничего, и человек узнаёт
   * об этом, потратив вечер. */
  let storageOk = null;

  function storageAvailable() {
    if (storageOk !== null) return storageOk;
    try {
      const probe = KEY + '.probe';
      localStorage.setItem(probe, '1');
      storageOk = localStorage.getItem(probe) === '1';
      localStorage.removeItem(probe);
    } catch (e) {
      storageOk = false;
    }
    return storageOk;
  }

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

  /* Приведение чужих данных к ожидаемому виду.
   *
   * Через migrate проходит всё, что приложение не писало само: сохранение из
   * localStorage, файл выгрузки, состояние из общей базы. Верить их форме
   * нельзя. Раньше и не проверялось: достаточно было, чтобы в файле нашлось
   * поле settings, — а дальше, если priceLog оказывался строкой вместо
   * массива, приложение падало на первой же отрисовке. Причём падало
   * НАВСЕГДА: битое состояние успевало записаться в localStorage и переживало
   * перезагрузку, так что выхода не оставалось, кроме как стереть хранилище
   * браузера вместе со всеми ценами и планами.
   *
   * Дойти до этого проще, чем кажется: файл выгрузки обрезается при неудачной
   * пересылке или синхронизации облака, и обрезанный он ломает всё. Поэтому
   * поле неверного типа не отвергается, а заменяется пустым значением нужного
   * вида: лучше потерять одно поле, чем всё приложение. */
  function asArray(value, fallback) {
    return Array.isArray(value) ? value : fallback;
  }

  function asObject(value, fallback) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  }

  /* Список, в котором каждый элемент — объект с нужными полями.
   *
   * Проверить сам список мало: Array.isArray([null]) — правда, а первое же
   * обращение к полю внутри падает. Одна такая запись в журнале цен валила
   * весь каталог, потому что каталог обходит журнал целиком.
   *
   * Негодные записи выбрасываются молча и поодиночке: файл выгрузки — это
   * годы правок цен, и терять их все из-за одной битой строки нельзя. */
  function asRecords(value, required) {
    return asArray(value, []).filter(function (item) {
      if (!asObject(item, null)) return false;
      return required.every(k => item[k] !== undefined && item[k] !== null);
    });
  }

  /* Кладовая и ей подобные: ключ — код продукта, значение обязано быть числом.
     Строка «много» вместо количества ломает всю арифметику ниже по течению. */
  function asNumberMap(value) {
    const src = asObject(value, {});
    const out = {};
    Object.keys(src).forEach(function (k) {
      const n = Number(src[k]);
      if (isFinite(n) && n > 0) out[k] = n;
    });
    return out;
  }

  /* Проверка плана недели.
   *
   * План — самая развесистая структура в состоянии: семь дней, в каждом
   * приёмы пищи, в каждом рецепт со списком ингредиентов. Обходят её десятки
   * мест, и почти все — без оглядки, потому что план всегда строило само
   * приложение. Но приходит он из хранилища и из файла выгрузки, а туда
   * попадает всякое: обрезанная при пересылке копия, сохранение от версии
   * с другой формой данных.
   *
   * Чиним посильное, отбрасываем безнадёжное. Приём пищи с рассыпавшимся
   * рецептом становится пустым — такое приложение переживает, оно умеет
   * дозаполнять пустые ячейки. А вот план без норм или без подсчитанного
   * КБЖУ восстановить нечем: эти цифры считает планировщик, которого здесь
   * нет. Такой план лучше забыть — неделя пересобирается одной кнопкой,
   * а вот выковырять окирпиченное приложение из браузера человеку нечем. */
  function sanePlan(plan) {
    if (!asObject(plan, null)) return null;
    if (!Array.isArray(plan.days) || !plan.days.length) return null;
    if (!asObject(plan.targets, null) || !asObject(plan.nutrition, null)) return null;

    plan.days = plan.days.filter(d => asObject(d, null) && Array.isArray(d.meals));
    if (!plan.days.length) return null;

    plan.days.forEach(function (day) {
      day.meals = day.meals.filter(m => asObject(m, null));
      day.meals.forEach(function (meal) {
        const r = asObject(meal.recipe, null);
        const ingOk = r && Array.isArray(r.ing) &&
          r.ing.every(i => asObject(i, null) && i.p !== undefined);
        if (!ingOk) { meal.recipe = null; meal.leftoverOf = null; return; }
        // Количество обязано быть числом: на него умножают в каждом расчёте,
        // и одна строка превращает всю неделю в NaN.
        r.ing.forEach(i => { const g = Number(i.g); i.g = isFinite(g) && g >= 0 ? g : 0; });
        const mult = Number(meal.mult);
        meal.mult = isFinite(mult) && mult > 0 ? mult : 1;
      });
    });

    plan.notes = asArray(plan.notes, []);
    plan.swaps = asRecords(plan.swaps, ['from', 'to']);
    plan.replacements = asRecords(plan.replacements, ['to']);
    return plan;
  }

  /* Дозаполняем поля, появившиеся в новых версиях, чтобы старые сохранения не ломались. */
  function migrate(saved) {
    saved = asObject(saved, {});

    /* Два отдельных набора значений по умолчанию, и это не расточительность.
     *
     * Object.assign(base, saved) возвращает тот самый base, а не копию: он его
     * же и портит. Значит запасное значение вида base.regulars, взятое после
     * этой строки, — уже не значение по умолчанию, а то самое мусорное поле
     * из файла, от которого мы и защищаемся. Проверка при этом выглядит
     * совершенно правильной и молча пропускает всё. Поэтому pristine
     * заводится заранее и до конца остаётся нетронутым. */
    const pristine = defaultState();
    const base = defaultState();
    const merged = Object.assign(base, saved);

    merged.settings = Object.assign(pristine.settings, asObject(saved.settings, {}));
    merged.regulars = saved.regulars === undefined
      ? pristine.regulars
      : asRecords(saved.regulars, ['p']);
    merged.pantry = asNumberMap(saved.pantry);
    merged.excluded = asObject(saved.excluded, {});
    merged.prices = asObject(saved.prices, {});
    merged.priceLog = asRecords(saved.priceLog, ['p', 'pr']);
    merged.brandChoice = asObject(saved.brandChoice, {});
    merged.dismissedSwaps = asObject(saved.dismissedSwaps, {});
    // Названия магазинов идут в подписи и в выпадающие списки — там ждут строку.
    merged.stores = asArray(saved.stores, pristine.stores).filter(x => typeof x === 'string');
    if (!merged.stores.length) merged.stores = pristine.stores;
    // Свой продукт без кода или названия не продукт: по коду его ищут рецепты,
    // по названию сортируют список цен.
    merged.customProducts = asRecords(saved.customProducts, ['id', 'n']);
    merged.customRecipes = asRecords(saved.customRecipes, ['id', 'n', 'ing'])
      .filter(r => Array.isArray(r.ing) && Array.isArray(r.m));
    merged.disabledRecipes = asObject(saved.disabledRecipes, {});
    merged.listState = asObject(saved.listState, {});
    merged.history = asRecords(saved.history, []);
    merged.plan = sanePlan(asObject(saved.plan, null));

    // Профили — самое чувствительное место: по ним считаются нормы питания.
    // Строка вместо списка профилей раньше валила расчёт насмерть, потому что
    // у неё есть length, но нет map.
    const savedPeople = asArray(saved.people, []).filter(p => asObject(p, null));
    merged.people = savedPeople.length
      ? savedPeople.map(p => Object.assign(defaultPerson(p.id, p.name, p.sex), p))
      : pristine.people;

    // Раньше приёмы пищи были общими на всех. Переносим их в каждый профиль,
    // чтобы дальше настраивать по человеку.
    const commonMeals = asArray(asObject(saved.settings, {}).mealsActive, pristine.settings.mealsActive);
    merged.settings.mealsActive = asArray(merged.settings.mealsActive, pristine.settings.mealsActive);
    merged.people.forEach(function (p) {
      if (!Array.isArray(p.meals) || !p.meals.length) p.meals = commonMeals.slice();
      if (!Array.isArray(p.diets)) p.diets = [];
      // Числа, по которым считается норма. Строка «семьдесят» вместо веса
      // превратила бы всю арифметику в NaN и тихо испортила бы весь план.
      ['age', 'height', 'weight', 'activity'].forEach(function (k) {
        const n = Number(p[k]);
        if (!isFinite(n) || n <= 0) p[k] = defaultPerson(p.id, p.name, p.sex)[k];
        else p[k] = n;
      });
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

  /* Запись только в браузер — без обращения к общей базе. */
  let warnedAboutStorage = false;

  function persist() {
    invalidate();
    revision++;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false;
      // Ровно один раз за сеанс. Раньше здесь был alert на каждую запись,
      // а записи идут на каждое действие: не сумев сохранить, приложение
      // заваливало человека одинаковыми окнами, и работать становилось
      // невозможно ровно тогда, когда и так всё плохо.
      if (!warnedAboutStorage) {
        warnedAboutStorage = true;
        console.warn('Не удалось сохранить данные:', e);
        alert('Браузер не даёт сохранить данные: ' + e.message +
          '\n\nРаботать можно, но после закрытия вкладки всё пропадёт. ' +
          'Выгрузите копию через «Настройки → Данные».');
      }
    }
  }

  function save() {
    persist();
    // Локальная запись уже прошла, поэтому отправка наружу ничего не задерживает
    // и её неудача ничего не теряет: данные остались в браузере и уедут
    // при следующей попытке.
    if (window.App.account) window.App.account.schedulePush();
    if (window.App.sync) window.App.sync.push(() => state);
  }

  /* Принять состояние, пришедшее с другого устройства. Обратно не отправляем —
     иначе два устройства будут бесконечно пересылать друг другу одно и то же. */
  /* Принять состояние, пришедшее снаружи.
     silent — «это уже и есть версия из облака, отправлять её обратно незачем»:
     без него два устройства пересылали бы друг другу одно и то же по кругу. */
  function adopt(remote, opts) {
    state = migrate(remote);
    if (opts && opts.silent) persist();
    else save();
    return state;
  }

  function get() {
    if (!state) load();
    return state;
  }

  /* Текущий план — всегда живой объект из состояния.
   *
   * Брать его надо здесь и в момент действия, а не запоминать при отрисовке:
   * синхронизация с другого устройства заменяет state.plan новым объектом,
   * и обработчик кнопки, державший прежнюю ссылку, начинает править сироту.
   * Внешне это выглядит так, будто кнопка не работает. */
  function plan() {
    return get().plan;
  }

  /* Приём пищи по дню и типу. Ссылку на сам приём хранить нельзя
     по той же причине, что и ссылку на план. */
  function mealAt(dayIndex, slot) {
    const p = plan();
    if (!p || !p.days || !p.days[dayIndex]) return null;
    return p.days[dayIndex].meals.find(m => m.slot === slot) || null;
  }

  /* local — стереть только из этого браузера, не трогая облако.
     Так уходит выход из аккаунта: данные обязаны исчезнуть с устройства,
     чтобы их не увидел следующий человек, но остаться в хозяйстве. */
  function reset(opts) {
    state = defaultState();
    if (opts && opts.local) persist();
    else save();
    return state;
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

  /* Ограничения домохозяйства — объединение режимов всех едоков.
   *
   * Хранятся они у человека, но действуют на общее блюдо: готовим одну
   * кастрюлю, поэтому если гастрит у одного из двоих, щадящим становится
   * общий обед. Иначе пришлось бы готовить дважды. */
  function householdRestrictions() {
    const ids = [];
    get().people.forEach(function (p) {
      (p.diets || []).forEach(function (d) { if (ids.indexOf(d) === -1) ids.push(d); });
    });
    return window.App.restrictionsFor ? window.App.restrictionsFor(ids) : { avoid: {}, limit: {}, methods: {} };
  }

  function activeDiets() {
    const ids = [];
    get().people.forEach(function (p) {
      (p.diets || []).forEach(function (d) { if (ids.indexOf(d) === -1) ids.push(d); });
    });
    return ids;
  }

  /* Какой режим запрещает этот продукт. Возвращает название режима
     или null — так интерфейс может объяснить, почему продукт пропал. */
  function blockedBy(product) {
    const ids = activeDiets();
    const tags = product.tg || [];
    for (let i = 0; i < ids.length; i++) {
      const d = window.App.dietById ? window.App.dietById[ids[i]] : null;
      if (!d) continue;
      if (d.avoid.some(t => tags.indexOf(t) !== -1)) return d;
    }
    return null;
  }

  function isProductAllowed(product) {
    return !blockedBy(product);
  }

  /* Рецепт отсеивается, если содержит исключённый продукт, выключен вручную
     или не проходит по диетическому режиму — по продукту либо по способу готовки. */
  function recipes() {
    const s = get();
    const all = window.App.seedRecipes.concat(s.customRecipes || []);
    const limits = householdRestrictions();
    const byId = productsById();
    const rawTags = limits.avoidRaw || {};
    const hasLimits = Object.keys(limits.avoid).length ||
      Object.keys(limits.methods).length || Object.keys(rawTags).length;

    return all.filter(function (r) {
      if (s.disabledRecipes[r.id]) return false;
      if (r.ing.some(i => s.excluded[i.p])) return false;
      if (!hasLimits) return true;

      if ((r.mth || []).some(m => limits.methods[m])) return false;

      // Грубая клетчатка мешает только сырой: варёная капуста в щах
      // и та же капуста в салате — разная нагрузка на желудок.
      const noHeat = (r.mth || ['boil']).every(m => m === 'raw');

      return !r.ing.some(function (i) {
        const p = byId[i.p];
        if (!p) return false;
        const tags = p.tg || [];
        if (tags.some(t => limits.avoid[t])) return true;
        return noHeat && tags.some(t => rawTags[t]);
      });
    });
  }

  /* Сколько блюд осталось на каждый приём пищи. Если режимы срезали почти всё,
     об этом надо сказать прямо, а не выдавать неделю из трёх повторов. */
  function recipeAvailability() {
    const left = recipes();
    const out = {};
    Object.keys(window.App.MEALS).forEach(function (slot) {
      out[slot] = left.filter(r => r.m.indexOf(slot) !== -1).length;
    });
    return out;
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
    week:      { n: 'шт в неделю',    weeks: 1 },
    two_weeks: { n: 'шт в 2 недели',  weeks: 2 },
    month:     { n: 'шт в месяц',     weeks: 4.3 },
    two_months:{ n: 'шт в 2 месяца',  weeks: 8.7 },
    quarter:   { n: 'шт в 3 месяца',  weeks: 13 },
    halfyear:  { n: 'шт в полгода',   weeks: 26 },
    year:      { n: 'шт в год',       weeks: 52 }
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

  /* Отклонённые предложения замен. */
  function dismissSwap(fromId, toId) {
    const s = get();
    s.dismissedSwaps = s.dismissedSwaps || {};
    s.dismissedSwaps[fromId + '>' + toId] = true;
    save();
  }

  function restoreSwaps() {
    get().dismissedSwaps = {};
    save();
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
    load, save, get, reset, today, localDate, adopt, persist, plan, mealAt, storageAvailable,
    revision: () => revision,
    products, productsById, pricePerBase, isStale, daysSince, setPrice,
    recordPrice, priceHistory, brandsOf, effectivePrice, invalidate,
    recipes, allRecipes, householdRestrictions, activeDiets, blockedBy, isProductAllowed, recipeAvailability,
    pantryAdd, pantrySet,
    weeklyBudget, regularsWeeklyCost, PERIODS, periodWeeks,
    dismissSwap, restoreSwaps,
    exportJson, importJson,
    defaultPerson
  };
})();
