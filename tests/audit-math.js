/* Независимая перепроверка математики.
 *
 * Смысл в том, чтобы НЕ пользоваться функциями приложения там, где проверяется
 * их результат. Тест, который считает тем же кодом, что и проверяет, доказывает
 * только внутреннюю согласованность: если формула неверна, он подтвердит
 * неверную формулу. Поэтому здесь всё пересчитывается заново, с нуля,
 * по определениям — и сравнивается с тем, что выдало приложение.
 */
const { makeEnv, withSeed } = require('./harness.js');

const App = makeEnv(null).App;
const { store, nutrition, shopping, planner } = App;
store.load();

const out = [];
let fails = 0;
function check(area, name, good, detail) {
  if (!good) fails++;
  out.push({ area, name, good, detail });
  console.log('  ' + (good ? '+' : '!') + ' ' + name + (detail ? '  — ' + detail : ''));
}
function section(n) { console.log('\n' + n); }

// ═══════════════════════════════ 1. НОРМЫ ПИТАНИЯ

section('1. Нормы питания — пересчёт по формуле из первоисточника');

/* Mifflin-St Jeor (1990): BMR = 10*вес(кг) + 6.25*рост(см) - 5*возраст + s,
   где s = +5 для мужчин и -161 для женщин. Считаем сами. */
function mifflinIndependent(w, h, a, male) {
  return 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);
}

let bmrBad = 0;
const samples = [];
for (let w = 45; w <= 130; w += 17) {
  for (let h = 150; h <= 195; h += 15) {
    for (let a = 18; a <= 70; a += 13) {
      for (const male of [true, false]) {
        const person = Object.assign(store.defaultPerson('x', 'x', male ? 'm' : 'f'),
          { weight: w, height: h, age: a });
        const mine = mifflinIndependent(w, h, a, male);
        const theirs = nutrition.bmr(person);
        samples.push(1);
        if (Math.abs(mine - theirs) > 0.0001) bmrBad++;
      }
    }
  }
}
check('нормы', 'базовый обмен совпал с формулой на ' + samples.length + ' сочетаниях',
  bmrBad === 0, bmrBad ? bmrBad + ' расхождений' : 'вес 45-130, рост 150-195, возраст 18-70, оба пола');

// Калории = BMR × активность × множитель цели. Пересчитываем сами.
const GOAL_MUL = { cut: 0.80, maintain: 1.00, bulk: 1.12 };
let kcalBad = 0, kcalCases = 0;
[1.2, 1.375, 1.55, 1.725, 1.9].forEach(function (act) {
  ['cut', 'maintain', 'bulk'].forEach(function (goal) {
    const p = Object.assign(store.defaultPerson('x', 'x', 'm'),
      { weight: 80, height: 180, age: 30, activity: act, goal: goal });
    const mine = Math.round(mifflinIndependent(80, 180, 30, true) * act * GOAL_MUL[goal]);
    const theirs = nutrition.personTargets(p).kcal;
    kcalCases++;
    if (mine !== theirs) kcalBad++;
  });
});
check('нормы', 'суточные калории совпали на ' + kcalCases + ' сочетаниях активности и цели',
  kcalBad === 0, kcalBad ? kcalBad + ' расхождений' : 'все 15');

// Белок не выше трети калорий, жир не ниже 0,8 г/кг — проверяем на краях.
let capBad = 0, floorBad = 0;
for (let w = 40; w <= 160; w += 10) {
  ['cut', 'maintain', 'bulk'].forEach(function (goal) {
    const p = Object.assign(store.defaultPerson('x', 'x', 'm'),
      { weight: w, height: 175, age: 30, goal: goal, activity: 1.9 });
    const t = nutrition.personTargets(p);
    if (t.p * 4 > t.kcal * 0.3501) capBad++;
    if (t.f < w * 0.8 - 1) floorBad++;
  });
}
check('нормы', 'белок нигде не выше трети калорий', capBad === 0,
  capBad ? capBad + ' нарушений' : 'вес от 40 до 160 кг, три цели');
check('нормы', 'жир нигде не ниже 0,8 г на кг', floorBad === 0,
  floorBad ? floorBad + ' нарушений' : 'вес от 40 до 160 кг');

// ═══════════════════════════════ 2. КБЖУ ПРОДУКТОВ

section('2. Каталог — сходятся ли калории с макронутриентами');

const byId = store.productsById();
const products = store.products().filter(p => p.role !== 'nonfood');
let macroOff = [];
products.forEach(function (p) {
  if (!p.k) return;
  const fromMacros = p.p * 4 + p.f * 9 + p.c * 4;   // коэффициенты Этуотера
  /* Допуск двойной: 30% ИЛИ 30 ккал, что больше.
   *
   * Одной доли мало. У лимона в каталоге 34 ккал при 0,9/0,1/3,0 — это
   * стандартное справочное значение, и разница с суммой макронутриентов
   * берётся из лимонной кислоты и клетчатки: калории они дают, а в углеводы
   * не входят. То же у шампиньонов и апельсинов. На низкокалорийном продукте
   * это даёт огромный процент при ничтожной разнице в килокалориях,
   * и проверка по доле ловила бы верные данные как ошибку. */
  const diff = Math.abs(fromMacros - p.k);
  if (diff > Math.max(30, p.k * 0.30)) macroOff.push(p.n + ' (' + p.k + ' против ' + Math.round(fromMacros) + ')');
});
check('каталог', 'калорийность всех ' + products.length + ' продуктов сходится с БЖУ',
  macroOff.length === 0, macroOff.length ? macroOff.slice(0, 3).join('; ') : 'допуск 30% или 30 ккал — на клетчатку и органические кислоты');

const negative = store.products().filter(p => p.pr < 0 || p.pack <= 0 || p.k < 0 || p.p < 0 || p.f < 0 || p.c < 0);
check('каталог', 'нет отрицательных цен, упаковок и БЖУ', negative.length === 0,
  negative.map(p => p.n).join(', ') || store.products().length + ' продуктов');

const wasteBad = store.products().filter(p => (p.wst || 0) < 0 || (p.wst || 0) >= 1);
check('каталог', 'доля отхода в разумных границах', wasteBad.length === 0,
  wasteBad.map(p => p.n).join(', ') || 'от 0 до 1');

// ═══════════════════════════════ 3. СПИСОК ПОКУПОК

section('3. Список покупок — пересчёт по упаковкам с нуля');

store.get().settings.startDay = '2026-09-07';
store.get().settings.budget = 25000;
store.get().pantry = {};
store.persist();
const plan = withSeed(11, () => planner.generate());
store.get().plan = plan;
store.persist();

/* Считаем потребность сами: обходим план, складываем граммы по продуктам,
   учитывая, что блюдо «на два дня» закупается один раз. */
const needMine = {};
plan.days.forEach(function (day) {
  day.meals.forEach(function (meal) {
    if (!meal.recipe) return;
    if (meal.leftoverOf != null) return;                     // вчерашнее не закупаем
    const mult = meal.buy != null ? meal.buy : meal.mult;
    if (mult <= 0) return;
    meal.recipe.ing.forEach(function (i) {
      needMine[i.p] = (needMine[i.p] || 0) + i.g * mult;
    });
  });
});

const needTheirs = shopping.aggregate(plan);
let aggBad = 0;
Object.keys(Object.assign({}, needMine, needTheirs)).forEach(function (id) {
  if (Math.abs((needMine[id] || 0) - (needTheirs[id] || 0)) > 0.001) aggBad++;
});
check('покупки', 'потребность в продуктах совпала с моим подсчётом', aggBad === 0,
  aggBad ? aggBad + ' расхождений' : Object.keys(needMine).length + ' продуктов');

/* Цена: весовое округляем вверх до шага, штучное — до целых упаковок. */
let costMine = 0;
Object.keys(needMine).forEach(function (id) {
  const p = byId[id];
  if (!p) return;
  const need = needMine[id];
  if (need <= 0.5) return;
  if (p.w) {
    const step = p.pack >= 1000 ? 50 : 10;
    costMine += Math.ceil(need / step) * step * (p.pr / p.pack);
  } else {
    costMine += Math.ceil(need / p.pack) * p.pr;
  }
});
const list = shopping.buildList(plan);
check('покупки', 'итог списка совпал с моим подсчётом по упаковкам',
  Math.abs(Math.round(costMine) - list.total) <= 1,
  'мой ' + Math.round(costMine) + ' ₽, приложение ' + list.total + ' ₽');

const mealsSum = plan.days.reduce((s, d) => s + d.meals.reduce((t, m) => t + planner.mealCost(plan, m), 0), 0);
check('покупки', 'сумма стоимостей блюд равна чеку', Math.abs(mealsSum - list.total) <= 1,
  mealsSum.toFixed(2) + ' ₽ против ' + list.total + ' ₽');

const under = list.items.filter(i => i.buyAmount > 0 && i.buyAmount < i.remaining - 0.001);
check('покупки', 'купленного хватает на все рецепты', under.length === 0,
  under.map(i => i.product.n).join(', ') || list.items.length + ' позиций');

// ═══════════════════════════════ 4. КЛАДОВАЯ

section('4. Кладовая — сохранение количества');

store.get().pantry = { rice: 3000, potato: 5000, buckwheat: 1500 };
store.persist();
const listP = shopping.buildList(plan);
let conserveBad = 0;
listP.items.forEach(function (it) {
  const had = store.get().pantry[it.product.id] || 0;
  // Взято из кладовой не больше, чем было, и не больше, чем нужно.
  if (it.fromPantry > had + 0.001 || it.fromPantry > it.required + 0.001) conserveBad++;
  // Потребность = взято из кладовой + остаток к покупке.
  if (Math.abs(it.required - (it.fromPantry + it.remaining)) > 0.001) conserveBad++;
});
check('кладовая', 'количество сохраняется: нужно = взято дома + куплено', conserveBad === 0,
  conserveBad ? conserveBad + ' нарушений' : listP.items.length + ' позиций');

const saved = shopping.buildList(plan, { usePantry: false }).total - listP.total;
check('кладовая', 'кладовая удешевляет закупку', saved >= 0, 'экономия ' + saved + ' ₽');

const after = shopping.pantryAfter(plan, listP);
check('кладовая', 'после недели нет отрицательных остатков',
  Object.keys(after).every(k => after[k] > 0), Object.keys(after).length + ' позиций');
store.get().pantry = {};
store.persist();

// ═══════════════════════════════ 5. БЮДЖЕТ

section('5. Бюджет — арифметика периодов');

const s = store.get().settings;
s.budget = 24000; s.period = 'month'; s.weeksInMonth = 4; s.outsideFood = 4000;
store.persist();
const b = store.weeklyBudget();
check('бюджет', 'месяц делится на недели', Math.abs(b.gross - 6000) < 0.01, b.gross.toFixed(0) + ' ₽ = 24000 / 4');
check('бюджет', 'еда вне дома вычитается', Math.abs(b.outside - 1000) < 0.01, b.outside.toFixed(0) + ' ₽ = 4000 / 4');
check('бюджет', 'на продукты = брутто − вне дома − регулярное',
  Math.abs(b.food - (b.gross - b.outside - b.regulars)) < 0.01,
  b.food.toFixed(0) + ' ₽');
s.budget = 100; store.persist();
check('бюджет', 'при нищем бюджете остаток не уходит в минус', store.weeklyBudget().food >= 0,
  store.weeklyBudget().food + ' ₽');
s.budget = 25000; s.outsideFood = 0; s.weeksInMonth = 4.3; store.persist();

// ═══════════════════════════════ 6. ПЛАНЫ

section('6. Планы — 30 посевов подряд');

const runs = [];
for (let seed = 1; seed <= 30; seed++) runs.push(withSeed(seed, () => planner.generate()));

const empties = runs.reduce((n, p) => n + p.days.reduce((m, d) => m + d.meals.filter(x => !x.recipe).length, 0), 0);
check('планы', 'ни одного пустого приёма пищи', empties === 0, empties + ' пустых на 30 планов');

const kcalWorst = Math.max(...runs.map(p => Math.abs(p.nutrition.week.kcal / p.targets.week.kcal - 1)));
check('планы', 'калории в допуске', kcalWorst <= s.kcalTolerance,
  'худшее отклонение ' + (kcalWorst * 100).toFixed(2) + '% при допуске ' + (s.kcalTolerance * 100) + '%');

const protWorst = Math.min(...runs.map(p => p.nutrition.week.p / p.targets.week.p));
check('планы', 'белок не ниже порога', protWorst >= s.proteinFloor - 0.001,
  'худший ' + Math.round(protWorst * 100) + '% при пороге ' + Math.round(s.proteinFloor * 100) + '%');

const dupDay = runs.reduce((n, p) => n + p.days.reduce(function (m, d) {
  const ids = d.meals.filter(x => x.recipe).map(x => x.recipe.id);
  return m + (ids.length - new Set(ids).size);
}, 0), 0);
check('планы', 'блюдо не повторяется внутри дня', dupDay === 0, dupDay + ' повторов');

const overRepeat = runs.filter(function (p) {
  const used = {};
  planner.allMeals(p).forEach(m => { if (m.recipe) used[m.recipe.id] = (used[m.recipe.id] || 0) + 1; });
  return Object.keys(used).some(k => used[k] > s.maxRepeat);
}).length;
check('планы', 'лимит повторов за неделю соблюдён', overRepeat === 0, overRepeat + ' планов из 30 сверх лимита');

const costMismatch = runs.filter(p => p.cost !== shopping.costOf(p)).length;
check('планы', 'записанная стоимость совпадает с пересчётом', costMismatch === 0, costMismatch + ' расхождений');

// Порции по людям должны складываться в целое блюдо.
let portionBad = 0, portionCases = 0;
runs.slice(0, 5).forEach(function (p) {
  planner.allMeals(p).forEach(function (m) {
    if (!m.recipe) return;
    const parts = planner.mealPortions(p, m);
    if (!parts.length) return;
    portionCases++;
    const shareSum = parts.reduce((a, x) => a + x.share, 0);
    if (Math.abs(shareSum - 1) > 0.001) portionBad++;
    const costSum = parts.reduce((a, x) => a + x.cost, 0);
    if (Math.abs(costSum - planner.mealCost(p, m)) > 0.01) portionBad++;
  });
});
check('планы', 'порции по людям складываются в целое блюдо', portionBad === 0,
  portionBad ? portionBad + ' нарушений' : portionCases + ' приёмов пищи проверено');

// ═══════════════════════════════ 7. ДАТЫ

section('7. Даты — самое частое место ошибок');

let dateBad = 0;
const RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
runs.slice(0, 10).forEach(function (p) {
  p.days.forEach(function (d) {
    if (RU[new Date(d.date + 'T12:00:00').getDay()] !== d.name) dateBad++;
  });
});
check('даты', 'дата каждого дня сходится с его названием', dateBad === 0,
  dateBad ? dateBad + ' расхождений' : '70 дней проверено');

// Полночь по местному времени не должна давать вчерашнюю дату.
let midnightBad = 0;
for (let m = 0; m < 12; m++) {
  const d = new Date(2026, m, 15, 0, 5);
  const expect = 2026 + '-' + String(m + 1).padStart(2, '0') + '-15';
  if (store.localDate(d) !== expect) midnightBad++;
}
check('даты', 'полночь не съезжает на вчера', midnightBad === 0,
  midnightBad ? midnightBad + ' месяцев' : 'проверены все 12 месяцев');

// Недели: вперёд и назад от якоря.
let weekBad = 0;
const anchor = store.planStart(store.plan());
for (let off = -21; off <= 21; off++) {
  const d = new Date(anchor + 'T00:00:00');
  d.setDate(d.getDate() + off);
  const got = store.weekStart(store.localDate(d));
  const expectShift = Math.floor(off / 7) * 7;
  const expectDate = new Date(anchor + 'T00:00:00');
  expectDate.setDate(expectDate.getDate() + expectShift);
  if (got !== store.localDate(expectDate)) weekBad++;
}
check('даты', 'неделя определяется верно на 43 днях вокруг якоря', weekBad === 0,
  weekBad ? weekBad + ' ошибок' : 'три недели назад и три вперёд');

// ═══════════════════════════════ 8. СЛИЯНИЕ

section('8. Слияние хозяйств — деньги не теряются и не удваиваются');

let mergeBad = 0;
[[15000, 'month', 4, 4000, 'week'], [20000, 'month', 4.3, 20000, 'month'], [7000, 'week', 4, 1000, 'week']]
  .forEach(function ([hb, hp, hw, gb, gp]) {
    const host = { settings: { budget: hb, period: hp, weeksInMonth: hw }, people: [] };
    const guest = { settings: { budget: gb, period: gp, weeksInMonth: hw }, people: [] };
    const merged = App.merge.mergeStates(host, guest);
    // Пересчитываем сами: обе стороны в неделю, сложить, вернуть в период хозяина.
    const hWeeks = hp === 'month' ? hw : 1;
    const gWeeks = gp === 'month' ? hw : 1;
    const mine = Math.round((hb / hWeeks + gb / gWeeks) * hWeeks);
    if (merged.settings.budget !== mine) mergeBad++;
  });
check('слияние', 'бюджеты складываются верно при любых периодах', mergeBad === 0,
  mergeBad ? mergeBad + ' расхождений' : 'три сочетания месяц/неделя');

const hostP = { settings: { budget: 1, period: 'week' }, people: [], pantry: { rice: 700 } };
const guestP = { settings: { budget: 1, period: 'week' }, people: [], pantry: { rice: 300, oats: 500 } };
const mp = App.merge.mergeStates(hostP, guestP).pantry;
check('слияние', 'кладовая складывается по количествам', mp.rice === 1000 && mp.oats === 500,
  'рис ' + mp.rice + ' г = 700 + 300');

console.log('\n' + '─'.repeat(64));
console.log(fails ? '  РАСХОЖДЕНИЙ: ' + fails : '  Вся математика сошлась при независимом пересчёте.');
// Результат остаётся в выводе; файл писать незачем.
/*
require('fs').writeFileSync(
  'C:/Users/pc/AppData/Local/Temp/claude/c--Users-pc-Desktop-SpendingsAnton/a9a8613b-3c95-4d16-9a64-2953c7059931/scratchpad/audit-result.json',
  JSON.stringify({ fails, checks: out }, null, 2));
*/
process.exit(fails ? 1 : 0);
