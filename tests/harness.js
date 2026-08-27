/* Загрузка модулей приложения в Node — без браузера и без сборки.
 *
 * Приложение написано так, что каждый файл сам вешает себя на window.App.
 * Значит, достаточно подсунуть ему объект window, и всё ядро — каталог,
 * рецепты, расчёт норм, список покупок, планировщик — оживает вне браузера.
 * Это и позволяет проверять математику без клика мышью.
 *
 * Порядок файлов повторяет index.html: он не случаен, модули рассчитывают
 * друг на друга в момент загрузки.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const CORE = [
  'js/data/products.js',
  'js/data/diets.js',
  'js/data/recipes.js',
  'js/core/nutrition.js',
  'js/core/sync.js',
  'js/core/store.js',
  'js/core/receipt.js',
  'js/core/shopping.js',
  'js/core/planner.js'
];

/* Заглушки ровно на то, что модули трогают при загрузке. Полноценный DOM
   для проверки расчётов не нужен: экраны рисуются отдельно, в render-тесте. */
function makeEnv(initialState) {
  const storage = {};
  if (initialState) storage['spendings.v1'] = JSON.stringify(initialState);

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; }
    },
    navigator: { onLine: true },
    location: { protocol: 'http:', hash: '', href: 'http://localhost:8777/' },
    fetch: () => Promise.reject(new Error('в тестах сети нет')),
    alert: m => { throw new Error('неожиданный alert: ' + m); },
    document: { addEventListener() {}, getElementById: () => null },
    addEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  CORE.forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  });
  return sandbox.window;
}

/* Свой генератор случайных чисел с посевом.
 *
 * Подбор блюд намеренно случаен, и без этого два прогона несравнимы: нельзя
 * понять, стал план дешевле от правки в коде или просто выпал другой набор
 * блюд. С фиксированным посевом один и тот же посев даёт один и тот же план,
 * и разницу между «до» и «после» видно честно. */
function seeded(seed) {                                   // mulberry32
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* Выполнить работу с предсказуемой случайностью и вернуть Math.random на место. */
function withSeed(seed, work) {
  const real = Math.random;
  Math.random = seeded(seed);
  try { return work(); } finally { Math.random = real; }
}

module.exports = { makeEnv, withSeed, seeded, ROOT, CORE };
