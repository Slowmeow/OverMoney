/* Отрисовка всех экранов в настоящем DOM — из собранного одного файла.
 *
 *   npm install jsdom          (один раз)
 *   python build.py            (собрать overmoney.html)
 *   node tests/render.js
 *
 * Зачем отдельно от run.js: тот проверяет числа и обходится без DOM,
 * а здесь проверяется, что экраны вообще строятся. Ошибка в отрисовке
 * ловится приложением и показывается карточкой «Что-то сломалось» —
 * то есть молча, без падения. Такую поломку легко не заметить глазами,
 * поэтому её ищем прямо.
 *
 * Берём именно собранный overmoney.html, а не index.html: так заодно
 * проверяется, что сборка для телефона склеила код в рабочем порядке.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'overmoney.html');

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

const dom = new JSDOM(fs.readFileSync(BUNDLE, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://localhost/'
});
const w = dom.window;

// Ошибки в отрисовке приложение ловит само и пишет в консоль — перехватываем.
const errors = [];
const realError = w.console.error;
w.console.error = function () {
  errors.push(Array.from(arguments).map(String).join(' '));
  realError.apply(w.console, arguments);
};

w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

const App = w.App;
App.store.load();
if (!App.store.plan()) {
  App.store.get().plan = App.planner.generate();
  App.store.persist();
}

const SCREENS = ['dashboard', 'week', 'list', 'pantry', 'prices', 'reports', 'settings'];
let broken = 0;

console.log('  экран        узлов  текста  ');
SCREENS.forEach(function (name) {
  let nodes = 0, chars = 0, note = '';
  try {
    const el = App.views[name].render();
    nodes = el.querySelectorAll('*').length;
    chars = el.textContent.trim().length;
    if (/Что-то сломалось/.test(el.textContent)) { note = '  <- КАРТОЧКА ОШИБКИ'; broken++; }
    else if (nodes < 5) { note = '  <- подозрительно пусто'; broken++; }
  } catch (err) {
    note = '  <- УПАЛ: ' + err.message;
    broken++;
  }
  console.log('  ' + name.padEnd(12) + String(nodes).padStart(5) + String(chars).padStart(8) + note);
});

console.log('\n  ошибок в консоли: ' + errors.length);
errors.slice(0, 5).forEach(e => console.log('    ! ' + e.slice(0, 160)));

if (broken || errors.length) {
  console.log('  ПРОВАЛЕНО');
  process.exit(1);
}
console.log('  Все ' + SCREENS.length + ' экранов отрисовались без ошибок.');
