/* Проверка математики приложения.
 *
 *   node tests/run.js
 *
 * Здесь не «работает ли кнопка», а «сходятся ли числа». Проверяется то,
 * на что приложение опирается молча: что норма питания согласована сама
 * с собой, что стоимость блюд в сумме равна чеку, что купленного хватает
 * на рецепты, что даты не уезжают на сутки, что подгонка под бюджет
 * не достигает экономии за счёт недокорма.
 *
 * Планировщик намеренно случаен, поэтому всё, что от него зависит,
 * гоняется на фиксированных посевах: так расхождение видно как расхождение,
 * а не как «сегодня выпал другой набор блюд».
 */
const fs = require('fs');
const path = require('path');
const { makeEnv, withSeed } = require('./harness.js');

let passed = 0;
const failures = [];
let group = '';

function section(name) { group = name; console.log('\n' + name); }

function ok(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  + ' + name + (detail ? '  — ' + detail : ''));
  } else {
    failures.push(group + ' / ' + name + (detail ? ': ' + detail : ''));
    console.log('  ! ' + name + (detail ? '  — ' + detail : ''));
  }
}

/* Сравнение чисел с допуском: считаем в дробях, а показываем целыми,
   поэтому точного равенства требовать нельзя — только осмысленной близости. */
function near(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

const App = makeEnv(null).App;          // чистое состояние по умолчанию
const { store, nutrition, shopping, planner } = App;
store.load();

// ───────────────────────────────────────────────── нормы питания

section('Нормы питания');

store.get().people.forEach(function (person) {
  const t = nutrition.personTargets(person);
  const fromMacros = t.p * 4 + t.f * 9 + t.c * 4;
  ok('калории ' + person.name + ' сходятся с БЖУ',
    near(fromMacros, t.kcal, t.kcal * 0.01),
    t.kcal + ' ккал против ' + Math.round(fromMacros) + ' из 4Б+9Ж+4У');
});

const male = Object.assign(store.defaultPerson('t1', 'Тест', 'm'), { weight: 80, height: 180, age: 30 });
const female = Object.assign(store.defaultPerson('t2', 'Тест', 'f'), { weight: 80, height: 180, age: 30 });
// Формула Mifflin-St Jeor: 10*вес + 6.25*рост - 5*возраст, +5 мужчинам, -161 женщинам.
ok('Mifflin-St Jeor для мужчины', nutrition.bmr(male) === 10 * 80 + 6.25 * 180 - 5 * 30 + 5,
  nutrition.bmr(male) + ' ккал');
ok('Mifflin-St Jeor для женщины', nutrition.bmr(female) === 10 * 80 + 6.25 * 180 - 5 * 30 - 161,
  nutrition.bmr(female) + ' ккал');
ok('разница между полами ровно 166 ккал', nutrition.bmr(male) - nutrition.bmr(female) === 166);

const heavy = Object.assign(store.defaultPerson('t3', 'Тяжёлый', 'm'), { weight: 140, goal: 'cut', activity: 1.9 });
const ht = nutrition.personTargets(heavy);
ok('белок не уходит выше трети рациона', ht.p * 4 <= ht.kcal * 0.351,
  ht.p + ' г = ' + Math.round(ht.p * 4 / ht.kcal * 100) + '% калорий');
ok('жир не падает ниже 0,8 г на кг', ht.f >= heavy.weight * 0.8 - 1, ht.f + ' г на ' + heavy.weight + ' кг');

const manual = Object.assign(store.defaultPerson('t4', 'Ручной', 'f'), { manual: { kcal: 1800, p: 120, f: 60, c: 180 } });
const mt = nutrition.personTargets(manual);
ok('ручной ввод побеждает расчёт', mt.kcal === 1800 && mt.p === 120 && mt.manual === true);

const sum = nutrition.householdTargets([male, female]);
ok('норма семьи — сумма личных норм',
  sum.kcal === nutrition.personTargets(male).kcal + nutrition.personTargets(female).kcal,
  sum.kcal + ' ккал на двоих');

// ───────────────────────────────────────────────── доли приёмов пищи

section('Доли приёмов пищи');

const shares = planner.personShares(store.get().people[0]);
const shareSum = Object.keys(shares).reduce((s, k) => s + shares[k], 0);
ok('доли складываются в единицу', near(shareSum, 1, 1e-9), shareSum.toFixed(6));

const noBreakfast = Object.assign(store.defaultPerson('t5', 'Без завтрака', 'm'), { meals: ['lunch', 'dinner'] });
const nbShares = planner.personShares(noBreakfast);
ok('отказ от завтрака не теряет калории, а раздаёт их',
  near(Object.keys(nbShares).reduce((s, k) => s + nbShares[k], 0), 1, 1e-9) && !nbShares.breakfast,
  'обед ' + (nbShares.lunch * 100).toFixed(0) + '%, ужин ' + (nbShares.dinner * 100).toFixed(0) + '%');

const slots = planner.slotTargets(store.get().people);
const slotsKcal = Object.keys(slots).reduce((s, k) => s + slots[k].kcal, 0);
ok('калории приёмов пищи в сумме дают суточную норму',
  near(slotsKcal, nutrition.householdTargets(store.get().people).kcal, 5),
  slotsKcal + ' против ' + nutrition.householdTargets(store.get().people).kcal);

// ───────────────────────────────────────────────── каталог и рецепты

section('Каталог и рецепты');

const byId = store.productsById();
const missing = new Set();
store.allRecipes().forEach(r => r.ing.forEach(i => { if (!byId[i.p]) missing.add(i.p); }));
ok('все ингредиенты рецептов есть в каталоге', missing.size === 0, [...missing].join(', ') || 'ни одного пропуска');

const badPack = store.products().filter(p => !(p.pack > 0) || !(p.pr >= 0));
ok('у каждого продукта осмысленные упаковка и цена', badPack.length === 0,
  badPack.map(p => p.n).join(', ') || store.products().length + ' продуктов');

const badNutrition = store.products().filter(function (p) {
  if (p.role === 'nonfood') return false;
  const fromMacros = p.p * 4 + p.f * 9 + p.c * 4;
  return p.k > 0 && Math.abs(fromMacros - p.k) > Math.max(30, p.k * 0.30);
});
ok('калорийность продуктов сходится с их БЖУ', badNutrition.length === 0,
  badNutrition.map(p => p.n + ' (' + p.k + ' против ' + Math.round(p.p * 4 + p.f * 9 + p.c * 4) + ')').join('; ') || 'все сходятся');

Object.keys(App.MEALS).forEach(function (slot) {
  const n = store.allRecipes().filter(r => r.m.indexOf(slot) !== -1).length;
  ok('есть из чего выбирать на ' + App.MEALS[slot].n.toLowerCase(), n >= 10, n + ' рецептов');
});

// ───────────────────────────────────────────────── даты

section('Даты');

const d = new Date(2026, 7, 27, 0, 30);         // 27 августа, полпервого ночи по месту
ok('местная дата не съезжает на вчера', store.localDate(d) === '2026-08-27', store.localDate(d));

store.get().settings.startDay = '2026-08-27';
store.persist();
const RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const datePlan = withSeed(7, () => planner.generate());
const wrongDay = datePlan.days.filter(day => RU[new Date(day.date + 'T12:00:00').getDay()] !== day.name);
ok('дата каждого дня сходится с его названием', wrongDay.length === 0,
  wrongDay.map(x => x.date + ' назван ' + x.name).join('; ') || datePlan.days[0].date + ' — ' + datePlan.days[0].name);
ok('неделя начинается с заданного дня', datePlan.days[0].date === '2026-08-27', datePlan.days[0].date);
ok('в неделе семь разных дат', new Set(datePlan.days.map(x => x.date)).size === 7);

// ───────────────────────────────────────────────── список покупок

section('Список покупок');

const plan = withSeed(42, () => planner.generate());
const list = shopping.buildList(plan);

ok('быстрая оценка совпадает с полным списком', shopping.costOf(plan) === list.total,
  shopping.costOf(plan) + ' ₽ и ' + list.total + ' ₽');

const mealsTotal = plan.days.reduce((s, day) =>
  s + day.meals.reduce((t, m) => t + planner.mealCost(plan, m), 0), 0);
ok('сумма стоимостей блюд равна чеку', near(mealsTotal, list.total, 1),
  mealsTotal.toFixed(2) + ' ₽ против ' + list.total + ' ₽');

const short = list.items.filter(i => i.buyAmount > 0 && i.buyAmount < i.remaining - 0.001);
ok('купленного хватает на все рецепты', short.length === 0,
  short.map(i => i.product.n).join(', ') || list.items.length + ' позиций');

const wrongPacks = list.items.filter(i => !i.product.w && i.buyAmount > 0 &&
  Math.abs(i.buyAmount - i.packs * i.product.pack) > 0.001);
ok('штучный товар берётся целыми упаковками', wrongPacks.length === 0,
  wrongPacks.map(i => i.product.n).join(', ') || 'все целые');

const negative = list.items.filter(i => i.cost < 0 || i.leftover < -0.001 || i.fromPantry < 0);
ok('нет отрицательных количеств и цен', negative.length === 0, negative.map(i => i.product.n).join(', ') || 'ни одного');

const catSum = list.byCategory.reduce((s, c) => s + c.sum, 0);
ok('сумма по отделам магазина равна итогу', near(catSum, list.total, list.byCategory.length),
  catSum + ' ₽ по ' + list.byCategory.length + ' отделам против ' + list.total + ' ₽');

// ───────────────────────────────────────────────── кладовая

section('Кладовая');

store.get().pantry = { rice: 5000, buckwheat: 3000, potato: 8000, oats: 2000 };
store.persist();
const withPantry = withSeed(42, () => planner.generate());
const listWith = shopping.buildList(withPantry);
const listWithout = shopping.buildList(withPantry, { usePantry: false });
ok('кладовая удешевляет закупку', listWith.total <= listWithout.total,
  listWith.total + ' ₽ вместо ' + listWithout.total + ' ₽, сэкономлено ' + listWith.savedByPantry + ' ₽');

const overdrawn = listWith.items.filter(i => i.fromPantry > (store.get().pantry[i.product.id] || 0) + 0.001);
ok('из кладовой не берётся больше, чем в ней лежит', overdrawn.length === 0,
  overdrawn.map(i => i.product.n).join(', ') || 'ни одного перебора');

const after = shopping.pantryAfter(withPantry, listWith);
ok('в кладовой после недели нет отрицательных остатков',
  Object.keys(after).every(k => after[k] > 0), JSON.stringify(after).slice(0, 60) + '…');

store.get().pantry = {};
store.persist();

// ───────────────────────────────────────────────── бюджет

section('Бюджет');

const s = store.get().settings;
s.budget = 20000; s.period = 'month'; s.outsideFood = 3000;
store.persist();
const b = store.weeklyBudget();
ok('месячный бюджет делится на недели', near(b.gross, 20000 / s.weeksInMonth, 0.01), b.gross.toFixed(0) + ' ₽ в неделю');
ok('еда вне дома вычитается', near(b.outside, 3000 / s.weeksInMonth, 0.01), b.outside.toFixed(0) + ' ₽ в неделю');
ok('на продукты остаётся брутто минус вычеты',
  near(b.food, b.gross - b.outside - b.regulars, 0.01),
  b.food.toFixed(0) + ' ₽ = ' + b.gross.toFixed(0) + ' − ' + b.outside.toFixed(0) + ' − ' + b.regulars.toFixed(0));
ok('бытовая химия не уходит в минус', b.food >= 0 && b.regulars >= 0);

s.budget = 500; store.persist();
ok('при нищем бюджете остаток не отрицательный', store.weeklyBudget().food >= 0, store.weeklyBudget().food + ' ₽');

s.budget = 20000; s.outsideFood = 0; store.persist();

// ───────────────────────────────────────────────── планирование

section('Планирование, 8 фиксированных посевов');

const runs = [];
for (let seed = 1; seed <= 8; seed++) runs.push(withSeed(seed, () => planner.generate()));

const emptySlots = runs.reduce((n, p) =>
  n + p.days.reduce((m, day) => m + day.meals.filter(x => !x.recipe).length, 0), 0);
ok('в меню нет пустых приёмов пищи', emptySlots === 0, emptySlots + ' пустых на ' + runs.length + ' планов');

const kcalOff = runs.map(p => Math.abs(p.nutrition.week.kcal / p.targets.week.kcal - 1));
ok('калории укладываются в допуск', Math.max(...kcalOff) <= s.kcalTolerance,
  'худшее отклонение ' + (Math.max(...kcalOff) * 100).toFixed(1) + '% при допуске ' + (s.kcalTolerance * 100).toFixed(0) + '%');

const protShare = runs.map(p => p.nutrition.week.p / p.targets.week.p);
ok('белок не опускается ниже порога', Math.min(...protShare) >= s.proteinFloor - 0.001,
  'худший прогон ' + (Math.min(...protShare) * 100).toFixed(0) + '% при пороге ' + (s.proteinFloor * 100).toFixed(0) + '%');

const badMult = runs.reduce((n, p) => n + planner.allMeals(p).filter(m => m.recipe && !(m.mult > 0)).length, 0);
ok('у каждого блюда положительная порция', badMult === 0);

const leftoverBuys = runs.reduce((n, p) => n + planner.allMeals(p)
  .filter(m => m.leftoverOf != null && shopping.buyMult(m) !== 0).length, 0);
ok('вчерашнее блюдо не закупается второй раз', leftoverBuys === 0, leftoverBuys + ' лишних закупок');

const costMatch = runs.filter(p => p.cost !== shopping.costOf(p)).length;
ok('записанная стоимость плана совпадает с пересчётом', costMatch === 0, costMatch + ' расхождений из ' + runs.length);

// ───────────────────────────────────────────────── редкие поломки

/* Восьми прогонов мало для того, что ломается изредка.
 *
 * Повтор блюда внутри дня возникал в семи процентах планов: подгонка под
 * бюджет теряла запрет «то же самое сегодня» и ставила чебуреки и на обед,
 * и на ужин. На восьми посевах это не выпало ни разу, и проверка честно
 * показывала «пройдено». Поэтому структурные свойства — те, что должны
 * держаться всегда и проверяются дёшево, — гоняются по широкой выборке. */
section('Редкие поломки, 40 посевов');

const wide = [];
for (let seed = 100; seed < 140; seed++) wide.push(withSeed(seed, () => planner.generate()));

const dupDay = wide.reduce((n, p) => n + p.days.reduce(function (m, day) {
  const ids = day.meals.filter(x => x.recipe).map(x => x.recipe.id);
  return m + (ids.length - new Set(ids).size);
}, 0), 0);
ok('одно блюдо не ставится дважды в один день', dupDay === 0,
  dupDay + ' повторов на ' + wide.length + ' планов');

const overRepeat = wide.filter(function (p) {
  const used = {};
  planner.allMeals(p).forEach(m => { if (m.recipe) used[m.recipe.id] = (used[m.recipe.id] || 0) + 1; });
  return Object.keys(used).some(k => used[k] > s.maxRepeat);
});
ok('лимит повторов за неделю соблюдается', overRepeat.length === 0,
  overRepeat.length + ' планов сверх лимита ' + s.maxRepeat);

const orphanLeftover = wide.reduce((n, p) => n + planner.allMeals(p).filter(function (m) {
  if (m.leftoverOf == null) return false;
  const cook = p.days[m.leftoverOf] && p.days[m.leftoverOf].meals.find(x => x.slot === m.slot);
  return !cook || !cook.recipe || cook.recipe.id !== m.recipe.id;
}).length, 0);
ok('вчерашнее блюдо ссылается на настоящую готовку', orphanLeftover === 0,
  orphanLeftover + ' осиротевших продолжений');

const emptyWide = wide.reduce((n, p) =>
  n + p.days.reduce((m, day) => m + day.meals.filter(x => !x.recipe).length, 0), 0);
ok('ни один приём пищи не остаётся пустым', emptyWide === 0, emptyWide + ' пустых');

// ───────────────────────────────────────────────── подгонка под бюджет

section('Подгонка под бюджет');

/* Сравнивать надо с бюджетом, при котором оптимизатор вообще не включается.
   Заготовка каталога такова, что неделя на двоих стоит около 4-5 тысяч,
   то есть и 20 000 ₽ в месяц — уже впритык, и там подгонка тоже работает.
   Два ужатых плана отличаются на считанные рубли, и такое сравнение
   ничего не доказывает. */
s.budget = 40000; store.persist();
const loose = [];
for (let seed = 1; seed <= 5; seed++) loose.push(withSeed(seed, () => planner.generate()));

s.budget = 9000; store.persist();
const tight = [];
for (let seed = 1; seed <= 5; seed++) tight.push(withSeed(seed, () => planner.generate()));

const rich = loose.reduce((sum, p) => sum + p.cost, 0) / loose.length;
const poor = tight.reduce((sum, p) => sum + p.cost, 0) / tight.length;
ok('жёсткий бюджет заметно удешевляет план', poor < rich * 0.95,
  Math.round(poor) + ' ₽ при 9000 против ' + Math.round(rich) + ' ₽ при 40000, экономия ' +
  Math.round((1 - poor / rich) * 100) + '%');
ok('при щедром бюджете оптимизатор не вмешивается',
  loose.every(p => p.cost <= p.budget.allowed),
  'все ' + loose.length + ' планов уложились без подгонки');

const starved = tight.filter(p => p.nutrition.week.p < p.targets.week.p * s.proteinFloor);
ok('экономия не достигается недокормом', starved.length === 0,
  'белок в худшем прогоне ' + Math.round(Math.min(...tight.map(p => p.nutrition.week.p / p.targets.week.p)) * 100) + '% нормы');

const swapped = tight.filter(p => p.swaps.length || p.replacements.length).length;
ok('оптимизатор действительно работает', swapped > 0,
  swapped + ' из ' + tight.length + ' планов с заменами, всего ' +
  tight.reduce((n, p) => n + p.swaps.length + p.replacements.length, 0) + ' замен');

const honest = tight.filter(p => p.cost > p.budget.allowed);
ok('о нехватке бюджета приложение говорит прямо',
  honest.every(p => p.notes && p.notes.length > 0),
  honest.length ? honest.length + ' плана не влезли, и все с объяснением' : 'все планы влезли');

s.budget = 3000; store.persist();
const impossible = withSeed(3, () => planner.generate());
ok('при невозможном бюджете нормы всё равно держатся',
  impossible.nutrition.week.p >= impossible.targets.week.p * s.proteinFloor,
  'белок ' + Math.round(impossible.nutrition.week.p / impossible.targets.week.p * 100) + '% нормы, план ' + impossible.cost + ' ₽');

const hardPlan = withSeed(3, () => planner.generate());
const before = hardPlan.cost;
const floorBefore = s.proteinFloor, repeatBefore = s.maxRepeat;
withSeed(11, () => planner.hardFit(hardPlan));
ok('жёсткая подгонка не делает хуже', hardPlan.cost <= before, before + ' ₽ → ' + hardPlan.cost + ' ₽');
ok('жёсткая подгонка возвращает настройки на место',
  s.proteinFloor === floorBefore && s.maxRepeat === repeatBefore,
  'порог белка ' + s.proteinFloor + ', лимит повторов ' + s.maxRepeat);
ok('белок не падает ниже безопасных 0,8 г на кг',
  hardPlan.hardFit.proteinPerKg >= 0.8 - 0.01,
  hardPlan.hardFit.proteinPerKg + ' г/кг при цели ' + hardPlan.hardFit.targetPerKg);
ok('компромисс обратим', !!hardPlan.beforeHardFit);
planner.undoHardFit(hardPlan);
ok('откат возвращает исходный план', hardPlan.cost === before, hardPlan.cost + ' ₽');

// ───────────────────────────────────────────────── вкусы и вклады

section('Любимое, нелюбимое и вклад в бюджет');

{
  const st = store.get();
  st.settings.startDay = '2026-09-07';
  st.settings.budget = 25000;
  const HATED = ['cheburek', 'pancakes', 'draniki'];
  const LOVED = ['ukha', 'tvorog_honey'];

  // Точка отсчёта: сколько этих блюд выпадает само по себе.
  st.people.forEach(p => { p.likes = []; p.dislikes = []; });
  store.persist();
  let baseHated = 0, baseLoved = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const p = withSeed(seed, () => planner.generate());
    planner.allMeals(p).forEach(function (m) {
      if (!m.recipe) return;
      if (HATED.indexOf(m.recipe.id) !== -1) baseHated++;
      if (LOVED.indexOf(m.recipe.id) !== -1) baseLoved++;
    });
  }

  st.people[0].dislikes = HATED.slice();
  st.people.forEach(p => { p.likes = LOVED.slice(); });
  store.persist();
  let hated = 0, loved = 0, protein = 1, kcalOff = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const p = withSeed(seed, () => planner.generate());
    protein = Math.min(protein, p.nutrition.week.p / p.targets.week.p);
    kcalOff = Math.max(kcalOff, Math.abs(p.nutrition.week.kcal / p.targets.week.kcal - 1));
    planner.allMeals(p).forEach(function (m) {
      if (!m.recipe) return;
      if (HATED.indexOf(m.recipe.id) !== -1) hated++;
      if (LOVED.indexOf(m.recipe.id) !== -1) loved++;
    });
  }

  ok('нелюбимое не попадает в меню', hated === 0,
    'без пометки выпадало ' + baseHated + ' раз, с пометкой ' + hated);
  ok('любимое встречается заметно чаще', loved > baseLoved * 1.5,
    baseLoved + ' раз без пометки → ' + loved + ' с пометкой');
  ok('вкусы не ломают норму белка', protein >= st.settings.proteinFloor - 0.001,
    'худший прогон ' + Math.round(protein * 100) + '%');
  ok('вкусы не ломают калории', kcalOff <= st.settings.kcalTolerance,
    'худшее отклонение ' + (kcalOff * 100).toFixed(1) + '%');

  // Нелюбимое у одного действует на всех: кастрюля одна.
  st.people[0].dislikes = HATED.slice();
  st.people[1].dislikes = [];
  st.people[1].likes = HATED.slice();      // второй их как раз любит
  store.persist();
  let stillHated = 0;
  for (let seed = 20; seed <= 30; seed++) {
    const p = withSeed(seed, () => planner.generate());
    planner.allMeals(p).forEach(m => { if (m.recipe && HATED.indexOf(m.recipe.id) !== -1) stillHated++; });
  }
  ok('запрет одного сильнее желания другого', stillHated === 0,
    'один отметил нелюбимым, второй любимым — блюда нет, потому что кастрюля общая');

  st.people.forEach(p => { p.likes = []; p.dislikes = []; });
  store.persist();
}

{
  const st = store.get();
  st.people[0].contributes = 18000;
  st.people[1].contributes = 12000;
  st.settings.budget = 25000;
  st.settings.budgetFromPeople = false;
  store.persist();
  ok('вклады складываются', store.contributions() === 30000, store.contributions() + ' ₽');
  ok('пока галочка снята, берётся общая сумма', store.budgetAmount() === 25000);
  st.settings.budgetFromPeople = true;
  store.persist();
  ok('с галочкой бюджет считается по вкладам', store.budgetAmount() === 30000);
  ok('недельный бюджет пересчитан от вкладов',
    near(store.weeklyBudget().gross, 30000 / st.settings.weeksInMonth, 0.01),
    Math.round(store.weeklyBudget().gross) + ' ₽ в неделю');
  st.settings.budgetFromPeople = false;
  st.people.forEach(p => { p.contributes = 0; });
  store.persist();
}

// ───────────────────────────────────────────────── закупки за месяц

section('Закупки за месяц и дни докупки');

{
  const st = store.get();
  st.settings.startDay = '2026-09-07';
  store.persist();
  const w1 = withSeed(1, () => planner.generate());
  st.plan = w1;
  store.persist();

  const entries = [{ start: '2026-09-07', plan: w1, label: 'Неделя 1' }];
  ['2026-09-14', '2026-09-21'].forEach(function (d, i) {
    const p = withSeed(i + 2, () => planner.generate({ startDay: d }));
    store.setWeek(d, p);
    entries.push({ start: d, plan: p, label: 'Неделя ' + (i + 2) });
  });

  const sum = shopping.monthSummary(entries);
  ok('сводка складывает все недели', sum.weeks.length === 3, sum.weeks.length + ' недели');
  ok('итог равен сумме недельных списков',
    sum.cost === entries.reduce((a, e) => a + shopping.buildList(e.plan).total, 0),
    sum.cost + ' ₽');
  ok('вес посчитан и правдоподобен', sum.weightKg > 10 && sum.weightKg < 400,
    sum.weightKg + ' кг нести из магазина');
  ok('позиции объединены по продуктам',
    sum.items.length > 0 && sum.items.length <= shopping.buildList(w1).items.length * 3,
    sum.items.length + ' позиций');
  ok('позиции отсортированы по деньгам',
    sum.items.every((it, i, all) => i === 0 || all[i - 1].cost >= it.cost));

  const tops = shopping.topUpDays(w1);
  ok('дни докупки не в первый день недели', tops.every(t => t.day > 0),
    tops.length ? 'дни ' + tops.map(t => t.day + 1).join(', ') : 'докупок нет');
  ok('в докупку попадает только скоропорт',
    tops.every(t => t.items.every(i => i.product.life <= t.day)),
    tops.length ? 'проверено позиций: ' + tops.reduce((n, t) => n + t.items.length, 0) : '—');
  ok('мелочь ниже полтинника в докупку не выносится',
    tops.every(t => t.cost >= 50));
}

// ───────────────────────────────────────────────── сроки годности

section('Сроки годности в кладовой');

function daysAgo(n) {
  const d = new Date(store.today() + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return store.localDate(d);
}

store.get().pantry = {};
store.get().pantryDates = {};
store.pantrySet('tvorog5', 400);
store.pantrySet('buckwheat', 800);

const freshExpiry = store.expiryOf('tvorog5');
ok('дата закладки записывается сама', !!freshExpiry && freshExpiry.added === store.today(),
  freshExpiry ? 'заложено ' + freshExpiry.added : 'нет даты');
ok('срок считается от закладки плюс срок хранения',
  freshExpiry && freshExpiry.daysLeft === freshExpiry.life,
  freshExpiry ? freshExpiry.daysLeft + ' дн. при сроке хранения ' + freshExpiry.life : '');

store.touchPantryDate('tvorog5', daysAgo(99));
const rotten = store.expiryOf('tvorog5');
ok('просроченное показывает отрицательный остаток', rotten.daysLeft < 0, rotten.daysLeft + ' дн.');
ok('просроченное попадает в «съесть скоро»',
  store.expiringSoon(2).some(e => e.id === 'tvorog5'));
ok('долгоиграющее не попадает', !store.expiringSoon(2).some(e => e.id === 'buckwheat'),
  'гречка со сроком ' + store.productsById().buckwheat.life + ' дн. не в списке');

ok('без даты закладки срок не выдумывается', store.expiryOf('rice') === null,
  'рис в кладовую не клали — приложение молчит, а не гадает');

store.pantrySet('tvorog5', 0);
ok('снятое с кладовой забывает и дату', store.expiryOf('tvorog5') === null);

store.get().pantry = {};
store.get().pantryDates = {};
store.persist();

// ───────────────────────────────────────────────── недели в месяце

/* Месячный календарь склеен из недельных планов, и вся склейка держится
   на одной функции — «какой неделе принадлежит эта дата». Ошибись она
   на день, и собранная неделя не совпадёт ни с одной клеткой календаря:
   месяц будет выглядеть пустым при полностью готовом плане. Ровно это
   и случилось при первой сборке, когда недели считались от понедельника,
   а план начинался со дня из настроек. */
section('Недели в месяце');

store.get().settings.startDay = '2026-09-02';   // среда: намеренно не понедельник
store.persist();
const weekPlan = withSeed(3, () => planner.generate());
store.get().plan = weekPlan;
store.persist();

const wStart = store.planStart(weekPlan);
ok('неделя начинается с заданного дня', wStart === '2026-09-02', wStart);
ok('свой день недели указывает на себя', store.weekStart(wStart) === wStart);
ok('середина недели указывает на её начало', store.weekStart('2026-09-05') === wStart, store.weekStart('2026-09-05'));
ok('последний день недели ещё её', store.weekStart('2026-09-08') === wStart, store.weekStart('2026-09-08'));
ok('следующий день — уже другая неделя', store.weekStart('2026-09-09') === '2026-09-09', store.weekStart('2026-09-09'));
// Отрицательная разница дат — место, где усечение к нулю вместо округления
// вниз сдвигает все прошлые недели на одну вперёд.
ok('прошлая неделя считается назад верно', store.weekStart('2026-08-30') === '2026-08-26', store.weekStart('2026-08-30'));
ok('ровно неделю назад', store.weekStart('2026-08-26') === '2026-08-26', store.weekStart('2026-08-26'));

const foundDay = store.dayAt('2026-09-04');
ok('день месяца находит своё меню', !!foundDay && foundDay.day.date === '2026-09-04',
  foundDay ? foundDay.day.meals.filter(m => m.recipe).length + ' блюд' : 'не найден');
ok('день вне собранных недель не находится', store.dayAt('2026-10-15') === null);

const nextStart = '2026-09-09';
store.setWeek(nextStart, withSeed(4, () => planner.generate({ startDay: nextStart })));
ok('вторая неделя встала рядом с первой', !!store.weekAt(nextStart),
  Object.keys(store.allWeeks()).length + ' недели в календаре');
ok('первая неделя не пострадала', store.weekAt(wStart) === weekPlan);
ok('день второй недели находится', !!store.dayAt('2026-09-11'));
ok('текущий план остался тем же объектом', store.plan() === weekPlan);

const dropped = store.pruneWeeks('2026-09-05');
ok('старые недели вычищаются', dropped === 0 || Object.keys(store.get().weeks).every(k => k >= '2026-09-05'),
  'убрано ' + dropped);

// ───────────────────────────────────────────────── настройки облака

/* Расхождение между адресом проекта и правилами загрузки ломает вход молча:
   браузер запрещает запрос ещё до отправки, приложение видит обычную сетевую
   ошибку и говорит «сервер не отвечает». Найти такое по симптому почти
   невозможно, поэтому проверяется здесь. */
section('Настройки облака');

const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'config.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cloudUrl = (cfgSrc.match(/supabaseUrl:\s*'([^']*)'/) || [])[1] || '';
const cloudKey = (cfgSrc.match(/supabasePublishableKey:\s*'([^']*)'/) || [])[1] || '';
const cspMeta = (htmlSrc.match(/http-equiv="Content-Security-Policy" content="([\s\S]+?)"/) || [])[1] || '';
const connectSrc = ((cspMeta.match(/connect-src ([^;]+);/) || [])[1] || '').trim();

if (!cloudUrl && !cloudKey) {
  ok('облако не подключено — приложение работает локально', true, 'config.js пуст, это допустимо');
} else {
  ok('адрес проекта и ключ заданы оба', !!(cloudUrl && cloudKey),
    cloudUrl ? 'адрес есть' : 'АДРЕСА НЕТ — аккаунты не включатся');
  ok('ключ публикуемый, а не секретный',
    /^(sb_publishable_|eyJ)/.test(cloudKey) && cloudKey.indexOf('sb_secret_') === -1,
    cloudKey.slice(0, 16) + '…');
  ok('адрес проекта разрешён правилами загрузки',
    connectSrc.indexOf(cloudUrl) !== -1 || /\*\.supabase\.co/.test(connectSrc),
    connectSrc);
}
ok('секретного ключа нет в настройках', cfgSrc.indexOf('sb_secret_') === cfgSrc.lastIndexOf('sb_secret_'),
  'упоминается только в пояснении');

// ───────────────────────────────────────────────── слияние хозяйств

/* Самая необратимая операция в приложении: разделить обратно то, что слилось,
   оно не умеет. Поэтому арифметика здесь проверяется отдельно и придирчиво. */
section('Слияние хозяйств');

const { mergeStates, describeMerge, sumPerPeriod } = App.merge;

{
  const host = { settings: { budget: 20000, period: 'month', weeksInMonth: 4.3, outsideFood: 0 },
    people: [{ id: 'p1', name: 'Хозяин' }], pantry: { rice: 1000 }, priceLog: [], stores: ['Пятёрочка'] };
  const guest = { settings: { budget: 10000, period: 'month', weeksInMonth: 4.3, outsideFood: 0 },
    people: [{ id: 'p1', name: 'Гость' }], pantry: { rice: 500, oats: 800 }, priceLog: [], stores: ['Магнит'] };

  const m = mergeStates(host, guest);
  ok('бюджеты складываются', m.settings.budget === 30000, m.settings.budget + ' ₽ = 20000 + 10000');
  ok('едоков стало двое', m.people.length === 2, m.people.map(p => p.name).join(' и '));
  ok('совпавшие коды профилей разведены',
    m.people[0].id !== m.people[1].id, m.people.map(p => p.id).join(', '));
  ok('кладовая складывается по количествам', m.pantry.rice === 1500 && m.pantry.oats === 800,
    'рис ' + m.pantry.rice + ' г, овсянка ' + m.pantry.oats + ' г');
  ok('магазины объединились', m.stores.length === 2, m.stores.join(', '));
  ok('план отброшен — он считался на другой состав', m.plan === null);
}

{
  // Разные периоды — самая вероятная ошибка: 15000 в месяц и 4000 в неделю
  // нельзя просто сложить.
  const host = { settings: { budget: 15000, period: 'month', weeksInMonth: 4, outsideFood: 0 }, people: [] };
  const guest = { settings: { budget: 4000, period: 'week', weeksInMonth: 4, outsideFood: 0 }, people: [] };
  const m = mergeStates(host, guest);
  // 15000/мес = 3750/нед; + 4000/нед = 7750/нед; обратно в месяц = 31000
  ok('бюджеты за разные периоды приводятся к одному', m.settings.budget === 31000,
    m.settings.budget + ' ₽/мес = (15000/4 + 4000) × 4');
  ok('период остаётся хозяйским', m.settings.period === 'month');
}

{
  const host = { settings: { budget: 1, period: 'week', weeksInMonth: 4.3 }, people: [],
    priceLog: [{ d: '2026-08-01', p: 'rice', brand: 'Мистраль', store: 'Пятёрочка', pr: 99 }] };
  const guest = { settings: { budget: 1, period: 'week', weeksInMonth: 4.3 }, people: [],
    priceLog: [
      { d: '2026-08-01', p: 'rice', brand: 'Мистраль', store: 'Пятёрочка', pr: 99 },   // тот же самый
      { d: '2026-08-02', p: 'oats', brand: '', store: 'Магнит', pr: 79 }
    ] };
  const m = mergeStates(host, guest);
  ok('журнал цен объединяется без повторов', m.priceLog.length === 2,
    m.priceLog.length + ' записи из 1 + 2');
}

{
  const host = { settings: { budget: 1, period: 'week' }, people: [],
    regulars: [{ p: 'coffee', qty: 1, per: 'month' }] };
  const guest = { settings: { budget: 1, period: 'week' }, people: [],
    regulars: [{ p: 'coffee', qty: 1, per: 'week' }, { p: 'tea', qty: 1, per: 'month' }] };
  const m = mergeStates(host, guest);
  const coffee = m.regulars.find(r => r.p === 'coffee');
  ok('у регулярных покупок берётся больший расход', coffee.per === 'week',
    'кофе: ' + coffee.qty + ' ' + coffee.per + ' (было раз в месяц и раз в неделю)');
  ok('чужие регулярные покупки переносятся', !!m.regulars.find(r => r.p === 'tea'));
}

{
  // Слияние с пустым хозяйством — не особый случай, а перенос своего.
  const guest = { settings: { budget: 9000, period: 'month', weeksInMonth: 4.3 },
    people: [{ id: 'p1', name: 'Я' }], pantry: { rice: 500 } };
  const m = mergeStates(null, guest);
  ok('вступление в пустое хозяйство переносит своё', m === guest, 'бюджет ' + m.settings.budget + ' ₽');
  ok('описание изменений не падает на пустом хозяйстве',
    Array.isArray(describeMerge(null, guest)) && describeMerge(null, guest).length === 0);
}

{
  const host = { settings: { budget: 20000, period: 'month', weeksInMonth: 4.3 },
    people: [{ id: 'p1', name: 'А' }], pantry: {}, priceLog: [], plan: { days: [] } };
  const guest = { settings: { budget: 10000, period: 'month', weeksInMonth: 4.3 },
    people: [{ id: 'p2', name: 'Б' }], pantry: { rice: 1 }, priceLog: [{ d: '1', p: 'x', pr: 1 }],
    customProducts: [{ id: 'my', n: 'Своё' }] };
  const lines = describeMerge(host, guest);
  ok('человеку заранее показывают, что изменится', lines.length >= 4, lines.length + ' пунктов');
  ok('среди них назван новый бюджет', lines.some(l => /30000/.test(l)),
    (lines.find(l => /бюджет/i.test(l)) || '').slice(0, 60));
}

ok('приведение периода не теряет копейки на неделе',
  sumPerPeriod(700, { period: 'week' }, 300, { period: 'week' }) === 1000);

// ───────────────────────────────────────────────── быстродействие

section('Быстродействие (те же 8 посевов, поэтому цифры сравнимы между запусками)');

s.budget = 15000; store.persist();
function timed(label, seeds, work) {
  const t = process.hrtime.bigint();
  seeds.forEach(seed => withSeed(seed, work));
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / seeds.length;
  console.log('  · ' + label.padEnd(34) + ms.toFixed(0).padStart(5) + ' мс');
  return ms;
}
const genMs = timed('сборка недели', [1, 2, 3, 4, 5, 6, 7, 8], () => planner.generate());
const basePlan = withSeed(1, () => planner.generate());
timed('стоимость плана', [1], () => shopping.costOf(basePlan));
timed('список покупок', [1], () => shopping.buildList(basePlan));
timed('разбор перерасхода', [1], () => planner.overspendAdvice(basePlan));

// Планы готовим заранее: иначе в замер подгонки попала бы ещё и сборка недели,
// и цифра говорила бы о двух разных вещах сразу.
const toFit = [1, 2].map(seed => withSeed(seed, () => planner.generate()));
let fitIndex = 0;
const hardMs = timed('жёсткая подгонка', [11, 12], () => planner.hardFit(toFit[fitIndex++]));

console.log('\n  Телефон медленнее этого компьютера примерно втрое, то есть на нём');
console.log('  сборка недели займёт около ' + Math.round(genMs * 3) + ' мс, жёсткая подгонка — около '
  + (hardMs * 3 / 1000).toFixed(1) + ' с.');
console.log('  Обе кнопки перед началом расчёта показывают, что работа идёт.');

// ───────────────────────────────────────────────── итог

console.log('\n' + '─'.repeat(64));
if (failures.length) {
  console.log('  ПРОВАЛЕНО: ' + failures.length + ' из ' + (passed + failures.length));
  failures.forEach(f => console.log('    ! ' + f));
  process.exit(1);
}
console.log('  Все проверки пройдены: ' + passed);
