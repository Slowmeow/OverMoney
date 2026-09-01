/* Проверка безопасности и живучести.
 *
 *   npm install jsdom       (один раз)
 *   python build.py         (собрать overmoney.html)
 *   node tests/security.js
 *
 * Модель угроз у приложения узкая, и полезно назвать её вслух. Сервера нет,
 * аккаунтов нет, секретов нет, чужих библиотек нет — красть с сервера нечего
 * и ломать на сервере нечего. Данные лежат в браузере самого человека.
 * Остаётся ровно два способа навредить, и оба проверяются здесь.
 *
 * Первый — выполнить чужой код в браузере через данные. Приложение показывает
 * названия продуктов, марки, магазины, имена профилей и шаги рецептов, а всё
 * это приходит из файла выгрузки, который человеку могли прислать. Если хоть
 * одна такая строка попадёт в разметку как разметка, присланный файл станет
 * способом выполнить код на странице — с доступом ко всем сохранённым данным.
 *
 * Второй — испортить данные так, чтобы приложение перестало открываться.
 * Это опаснее, чем кажется, и не требует злого умысла: файл выгрузки рвётся
 * при пересылке сам. Битое состояние успевает записаться в хранилище и
 * пережить перезагрузку, и человеку нечем его оттуда выковырять.
 *
 * Поэтому здесь не «выглядит ли код безопасным», а настоящие атаки и
 * настоящий перебор порчи, после каждой из которых приложение обязано
 * открыться.
 */
const fs = require('fs');
const path = require('path');

const BUNDLE = path.join(__dirname, '..', 'overmoney.html');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('  Пропущено: не установлен jsdom.  npm install jsdom');
  process.exit(0);
}
if (!fs.existsSync(BUNDLE)) {
  console.log('  Пропущено: нет overmoney.html.  python build.py');
  process.exit(0);
}

const HTML = fs.readFileSync(BUNDLE, 'utf8');
const SCREENS = ['dashboard', 'week', 'list', 'pantry', 'prices', 'reports', 'settings'];

function boot() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://slowmeow.github.io/OverMoney/'
  });
  const w = dom.window;
  w.alert = () => { w.__PWNED = 'alert'; };
  w.console.warn = () => {};
  w.console.error = () => {};
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return w;
}

let failures = 0;
function ok(name, bad, detail) {
  if (bad) { failures++; console.log('  ПРОБИТО  ' + name + (detail ? '  — ' + detail : '')); }
  else console.log('  устояло  ' + name + (detail ? '  — ' + detail : ''));
}

/* Полезная нагрузка выполнится сразу, как только попадёт в разметку разметкой:
   несуществующая картинка немедленно вызывает onerror. */
const XSS = '<img src=x onerror="window.__PWNED=\'xss\'">';

function pwned(w) {
  return !!w.__PWNED || w.document.querySelectorAll('img[src="x"]').length > 0;
}

function renderAll(w) {
  SCREENS.forEach(function (v) {
    try { w.document.body.appendChild(w.App.views[v].render()); } catch (e) { /* ловится отдельно */ }
  });
}

// ─────────────────────────────── выполнение чужого кода

console.log('\nВыполнение чужого кода через присланный файл');

{
  const w = boot();
  try {
    w.App.store.importJson(JSON.stringify({
      settings: { budget: 1 },
      __proto__: { pwned: 'yes' },
      people: [{ id: 'p1', name: 'x', sex: 'm', __proto__: { pwned: 'yes' } }]
    }));
  } catch (e) { /* отказ принять — законный исход */ }
  ok('загрязнение Object.prototype', ({}).pwned !== undefined || w.Object.prototype.pwned !== undefined,
    'прототип ' + (({}).pwned === undefined ? 'чист' : 'ЗАГРЯЖЁН'));
}

{
  const w = boot();
  w.App.store.importJson(JSON.stringify({
    settings: { budget: 15000 },
    customProducts: [{
      id: 'evil', n: XSS, cat: 'meat', unit: 'g', pack: 1000, pl: XSS,
      w: true, pr: 100, k: 100, p: 10, f: 5, c: 5, wst: 0, life: 10, grp: null, role: 'protein'
    }],
    pantry: { evil: 500 }
  }));
  renderAll(w);
  ok('скрипт в названии своего продукта', pwned(w));
}

{
  const w = boot();
  w.App.store.importJson(JSON.stringify({
    settings: { budget: 15000 },
    customRecipes: [{
      id: 'evilr', n: XSS, m: ['lunch'], t: 10, sv: 2,
      ing: [{ p: 'rice_round', g: 200 }], st: XSS, batch: false, mth: ['boil']
    }]
  }));
  w.App.store.get().plan = w.App.planner.generate();
  w.App.store.persist();
  renderAll(w);
  ok('скрипт в названии и шагах рецепта', pwned(w));
}

{
  const w = boot();
  w.App.store.importJson(JSON.stringify({
    settings: { budget: 15000 },
    stores: [XSS],
    priceLog: [{ d: '2026-08-01', p: 'rice_round', brand: XSS, store: XSS, pr: 99, pack: 800 }]
  }));
  renderAll(w);
  ok('скрипт в марке и магазине — они попадают в подписи графиков', pwned(w));
}

{
  const w = boot();
  w.App.store.importJson(JSON.stringify({
    settings: { budget: 15000 },
    people: [{
      id: 'p1', name: XSS, sex: 'm', age: 30, height: 175, weight: 75,
      activity: 1.375, goal: 'maintain', meals: ['breakfast', 'lunch', 'dinner'], diets: []
    }]
  }));
  w.App.store.get().plan = w.App.planner.generate();
  w.App.store.persist();
  renderAll(w);
  ok('скрипт в имени профиля', pwned(w));
}

// ─────────────────────────────── порча данных: перебор по полям

console.log('\nПорча состояния: каждое поле — каждым опасным значением');

{
  const w = boot();
  const A = w.App;
  const FIELDS = ['settings', 'people', 'regulars', 'pantry', 'excluded', 'prices', 'priceLog',
    'brandChoice', 'dismissedSwaps', 'stores', 'customProducts', 'customRecipes',
    'disabledRecipes', 'plan', 'listState', 'history', 'v'];
  const POISON = [null, undefined, 0, -1, NaN, '', 'строка', true, false, [], {}, [1, 2, 3],
    { a: 1 }, [null], [{}], 'null', 1e308, -1e308, { length: 5 }, [[]],
    '<script>x</script>', { __proto__: { p: 1 } }];

  let cases = 0, renderFails = 0, bricks = 0;
  const notes = [];

  for (const field of FIELDS) {
    for (const poison of POISON) {
      let payload;
      try {
        payload = JSON.parse(JSON.stringify(Object.assign(
          { settings: { budget: 15000, period: 'month' }, people: [], priceLog: [] },
          { [field]: poison })));
      } catch (e) { continue; }
      cases++;
      try { A.store.importJson(JSON.stringify(payload)); }
      catch (e) { continue; }                      // отказ принять файл — законный исход

      for (const v of SCREENS) {
        try { A.views[v].render(); }
        catch (e) {
          renderFails++;
          if (notes.length < 6) notes.push(field + ' = ' + JSON.stringify(poison) + ' -> ' + v + ': ' + e.message);
          break;
        }
      }
      // Пережить перезагрузку — отдельное требование: именно здесь порча
      // превращается из досадной в невосстановимую.
      try { A.store.load(); A.views.dashboard.render(); }
      catch (e) {
        bricks++;
        if (notes.length < 6) notes.push(field + ' = ' + JSON.stringify(poison) + ' -> ОКИРПИЧИЛО: ' + e.message);
      }
    }
  }
  notes.forEach(n => console.log('    ! ' + n));
  ok('приложение открывается после любой порчи', renderFails + bricks > 0,
    cases + ' сочетаний, отказов отрисовки ' + renderFails + ', окирпичиваний ' + bricks);
}

// ─────────────────────────────── порча данных: внутри плана

console.log('\nПорча внутри плана недели');

{
  const w = boot();
  const A = w.App;
  A.store.load();
  A.store.get().plan = A.planner.generate();
  const good = JSON.parse(JSON.stringify(A.store.get()));

  const MUTATIONS = [
    ['plan.days не массив', v => { v.plan.days = 'строка'; }],
    ['plan.days пуст', v => { v.plan.days = []; }],
    ['день = null', v => { v.plan.days[0] = null; }],
    ['день без приёмов пищи', v => { v.plan.days[0].meals = null; }],
    ['приём пищи = null', v => { v.plan.days[0].meals[0] = null; }],
    ['рецепт = null', v => { v.plan.days[0].meals[0].recipe = null; }],
    ['ингредиенты не массив', v => { v.plan.days[0].meals[0].recipe.ing = 'x'; }],
    ['ингредиент = null', v => { v.plan.days[0].meals[0].recipe.ing = [null]; }],
    ['граммы строкой', v => { v.plan.days[0].meals[0].recipe.ing[0].g = 'много'; }],
    ['несуществующий продукт', v => { v.plan.days[0].meals[0].recipe.ing[0].p = 'нет_такого'; }],
    ['порция = 0', v => { v.plan.days[0].meals[0].mult = 0; }],
    ['порция отрицательная', v => { v.plan.days[0].meals[0].mult = -5; }],
    ['порция строкой', v => { v.plan.days[0].meals[0].mult = 'nan'; }],
    ['ссылка на несуществующий день', v => { v.plan.days[0].meals[0].leftoverOf = 999; }],
    ['нет норм', v => { v.plan.targets = null; }],
    ['нет подсчитанного КБЖУ', v => { v.plan.nutrition = null; }],
    ['цели приёмов пищи строкой', v => { v.plan.slotTargets = 'x'; }],
    ['примечания не массив', v => { v.plan.notes = 'x'; }],
    ['замена = null', v => { v.plan.swaps = [null]; }],
    ['нет бюджета', v => { v.plan.budget = null; }],
    ['лимит повторов 0', v => { v.settings.maxRepeat = 0; }],
    ['недель в месяце 0', v => { v.settings.weeksInMonth = 0; }],
    ['отрицательный бюджет', v => { v.settings.budget = -100; }],
    ['порог белка 99', v => { v.settings.proteinFloor = 99; }],
    ['вес человека 0', v => { v.people[0].weight = 0; }],
    ['человек не ест ничего', v => { v.people[0].meals = []; }],
    ['режимы питания строкой', v => { v.people[0].diets = 'x'; }],
    ['профилей нет вовсе', v => { v.people = []; }]
  ];

  let broken = 0;
  for (const [name, mutate] of MUTATIONS) {
    const v = JSON.parse(JSON.stringify(good));
    try { mutate(v); } catch (e) { continue; }
    try { A.store.importJson(JSON.stringify(v)); }
    catch (e) { continue; }

    let note = '';
    for (const s of SCREENS) {
      try { A.views[s].render(); } catch (e) { note = 'экран ' + s + ': ' + e.message; break; }
    }
    if (!note) { try { A.planner.generate(); } catch (e) { note = 'сборка недели: ' + e.message; } }
    if (!note) { try { A.store.load(); A.views.dashboard.render(); } catch (e) { note = 'ОКИРПИЧИЛО: ' + e.message; } }
    if (note) { broken++; console.log('    ! ' + name + ' -> ' + note); }
  }
  ok('план переживает порчу на любом уровне', broken > 0, MUTATIONS.length + ' видов порчи');
}

// ─────────────────────────────── итог

console.log('\n' + '─'.repeat(64));
if (failures) {
  console.log('  НАЙДЕНО ДЫР: ' + failures);
  process.exit(1);
}
console.log('  Все проверки безопасности пройдены.');
