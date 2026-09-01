/* Проверка облачного слоя: вход, хозяйства, слияние, расхождения.
 *
 *   npm install jsdom
 *   python build.py
 *   node tests/cloud.js
 *
 * Здесь работает настоящий код приложения — cloud.js, account.js, merge.js,
 * store.js, — но против поддельного сервера. Два отдельных окна изображают
 * два устройства, у каждого своё хранилище, как в жизни.
 *
 * Проверяется то, что нельзя увидеть глазами и что дороже всего чинить
 * потом: не затирает ли второе устройство работу первого, не уносит ли
 * выход из аккаунта чужие данные на общем телефоне, доживает ли до сервера
 * последняя правка цены и не теряется ли ничего при слиянии хозяйств.
 */
const fs = require('fs');
const path = require('path');
const { makeServer } = require('./fake-supabase.js');

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

let failures = 0;
function ok(name, good, detail) {
  if (good) console.log('  + ' + name + (detail ? '  — ' + detail : ''));
  else { failures++; console.log('  ! ' + name + (detail ? '  — ' + detail : '')); }
}

function section(name) { console.log('\n' + name); }

/* Одно «устройство»: своя страница, своё хранилище, свой вход. */
function device(origin, label) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.example/'
  });
  const w = dom.window;
  w.alert = () => {};
  w.console.warn = () => {};
  w.console.error = () => {};
  // jsdom не умеет fetch — отдаём ему настоящий из Node.
  w.fetch = (input, init) => fetch(input, init);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

  // Подменяем настройки: приложение должно ходить к поддельному серверу.
  w.App.config = {
    get url() { return origin; },
    get anonKey() { return 'test-publishable-key'; },
    configured: () => true
  };
  w.__label = label;
  return w;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function () {
  const server = makeServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;

  // ─────────────────────────────────────────── вход

  section('Вход');

  const anton = device(origin, 'Антон');

  ok('без входа приложение заперто', anton.App.account.needsAuth(),
    'показывается экран входа, а не чужие данные');

  try {
    await anton.App.account.signIn('нет@такого.ру', 'пароль123');
    ok('неверный пароль не пускает', false, 'пустил');
  } catch (e) {
    ok('неверный пароль не пускает', /Неверная почта или пароль/.test(e.message), e.message);
  }

  try {
    await anton.App.account.signUp('anton@example.com', '123');
    ok('короткий пароль отклоняется', false, 'принял');
  } catch (e) {
    ok('короткий пароль отклоняется', /минимум 6/.test(e.message), e.message);
  }

  // До регистрации что-то наработано гостем — это не должно пропасть.
  anton.App.store.get().settings.budget = 21000;
  anton.App.store.get().pantry = { rice: 1200, buckwheat: 800 };
  anton.App.store.persist();

  await anton.App.account.signUp('anton@example.com', 'пароль123');
  ok('регистрация проходит', anton.App.cloud.signedIn(), anton.App.cloud.user().email);
  ok('после входа приложение открыто', !anton.App.account.needsAuth());

  const hh1 = anton.App.account.household;
  ok('хозяйство заводится само', !!hh1, hh1 && hh1.name);
  ok('код приглашения выдан', !!(hh1 && /^[2-9A-HJ-NP-Z]{8}$/.test(hh1.invite_code)), hh1 && hh1.invite_code);

  const seeded = server.state.households[hh1.id].state;
  ok('наработанное гостем перенеслось в аккаунт',
    seeded && seeded.settings.budget === 21000 && seeded.pantry.rice === 1200,
    'бюджет ' + (seeded && seeded.settings.budget) + ' ₽, риса ' + (seeded && seeded.pantry.rice) + ' г');

  // ─────────────────────────────────────────── второе устройство

  section('Второе устройство того же человека');

  const antonPhone = device(origin, 'Антон-телефон');
  await antonPhone.App.account.signIn('anton@example.com', 'пароль123');

  ok('телефон попал в то же хозяйство',
    antonPhone.App.account.household.id === hh1.id);
  ok('данные приехали на телефон',
    antonPhone.App.store.get().settings.budget === 21000 &&
    antonPhone.App.store.get().pantry.rice === 1200,
    'бюджет ' + antonPhone.App.store.get().settings.budget + ' ₽');

  // Правка в магазине с телефона
  antonPhone.App.store.get().pantry.rice = 400;
  antonPhone.App.store.save();
  await antonPhone.App.account.flushNow();
  await wait(50);

  await anton.App.account.pull();
  ok('правка с телефона доехала до компьютера',
    anton.App.store.get().pantry.rice === 400,
    'риса стало ' + anton.App.store.get().pantry.rice + ' г');

  // ─────────────────────────────────────────── расхождение

  section('Одновременная правка с двух устройств');

  anton.App.store.get().settings.budget = 25000;
  anton.App.store.save();
  await anton.App.account.flushNow();
  await wait(30);

  // Телефон не знает о правке и пишет по устаревшему номеру версии.
  antonPhone.App.store.get().settings.budget = 18000;
  antonPhone.App.store.save();
  const clash = await antonPhone.App.account.push(false);

  ok('второе устройство получает расхождение, а не затирает чужое',
    !!(clash && clash.conflict), 'сервер отверг запись по устаревшей версии');
  ok('на сервере уцелела первая правка',
    server.state.households[hh1.id].state.settings.budget === 25000,
    server.state.households[hh1.id].state.settings.budget + ' ₽');

  await antonPhone.App.account.acceptRemote(await antonPhone.App.cloud.fetchHousehold(hh1.id));
  ok('после принятия чужой версии расхождение снято',
    antonPhone.App.store.get().settings.budget === 25000 &&
    !antonPhone.App.account.status().conflict);

  // ─────────────────────────────────────────── объединение хозяйств

  section('Объединение двух хозяйств');

  const tasya = device(origin, 'Тася');
  tasya.App.store.get().settings.budget = 12000;
  tasya.App.store.get().settings.period = 'month';
  tasya.App.store.get().pantry = { oats: 900 };
  tasya.App.store.get().people = [{ id: 'p1', name: 'Тася', sex: 'f', age: 28, height: 165, weight: 55,
    activity: 1.375, goal: 'maintain', meals: ['breakfast', 'lunch', 'dinner'], diets: [] }];
  tasya.App.store.get().priceLog = [{ d: '2026-08-20', p: 'oats', brand: 'Ясно солнышко', store: 'Магнит', pr: 89 }];
  tasya.App.store.persist();

  await tasya.App.account.signUp('tasya@example.com', 'пароль123');
  const ownBefore = tasya.App.account.household.id;
  ok('у второго человека своё хозяйство', ownBefore !== hh1.id);

  const budgetBefore = server.state.households[hh1.id].state.settings.budget;
  const peopleBefore = server.state.households[hh1.id].state.people.length;

  await tasya.App.account.joinByCode(hh1.invite_code);

  ok('перешла в общее хозяйство', tasya.App.account.household.id === hh1.id);

  const merged = server.state.households[hh1.id].state;
  ok('бюджеты сложились', merged.settings.budget === budgetBefore + 12000,
    merged.settings.budget + ' ₽ = ' + budgetBefore + ' + 12000');
  ok('едоков стало больше', merged.people.length === peopleBefore + 1,
    merged.people.length + ' профиля');
  ok('её кладовая добавилась', merged.pantry.oats === 900, 'овсянки ' + merged.pantry.oats + ' г');
  ok('её цены перенеслись', merged.priceLog.some(e => e.p === 'oats' && e.pr === 89));
  ok('чужая кладовая уцелела', merged.pantry.rice === 400, 'риса ' + merged.pantry.rice + ' г');
  ok('план отброшен — состав едоков изменился', merged.plan === null);

  await anton.App.account.pull();
  ok('первый участник видит объединённое',
    anton.App.store.get().settings.budget === merged.settings.budget &&
    anton.App.store.get().pantry.oats === 900,
    'бюджет ' + anton.App.store.get().settings.budget + ' ₽');

  const people = await anton.App.account.people();
  ok('в хозяйстве видно обоих', people.length === 2, people.map(p => p.email).join(', '));

  // ─────────────────────────────────────────── выход

  section('Выход из аккаунта');

  await tasya.App.account.signOut();
  ok('после выхода приложение снова заперто', tasya.App.account.needsAuth());
  ok('данные стёрты с устройства',
    tasya.App.store.get().settings.budget === 15000 &&
    !Object.keys(tasya.App.store.get().pantry).length,
    'бюджет вернулся к значению по умолчанию, кладовая пуста');
  ok('в облаке данные целы',
    server.state.households[hh1.id].state.settings.budget === merged.settings.budget);

  await tasya.App.account.signIn('tasya@example.com', 'пароль123');
  ok('после повторного входа данные вернулись',
    tasya.App.store.get().settings.budget === merged.settings.budget &&
    tasya.App.store.get().pantry.oats === 900,
    'бюджет ' + tasya.App.store.get().settings.budget + ' ₽');

  // ─────────────────────────────────────────── выход из хозяйства

  section('Выход из общего хозяйства');

  await tasya.App.account.leave();
  const solo = tasya.App.account.household;
  ok('заводится своё хозяйство', solo && solo.id !== hh1.id, solo && solo.name);
  ok('копия данных остаётся при ней',
    server.state.households[solo.id].state.pantry.oats === 900,
    'овсянка на месте');
  ok('оставшийся ничего не потерял',
    server.state.households[hh1.id].state.pantry.oats === 900);

  const stillThere = await anton.App.account.people();
  ok('в общем хозяйстве остался один', stillThere.length === 1, stillThere[0].email);

  // ─────────────────────────────────────────── истёкший ключ

  section('Истёкший ключ доступа');

  server.tokenTtl = 1;                     // следующий вход выдаст ключ на секунду
  const shorty = device(origin, 'Коротышка');
  await shorty.App.account.signUp('short@example.com', 'пароль123');
  const before = server.refreshCount;
  await wait(1200);                        // ключ протух

  shorty.App.store.get().settings.budget = 7777;
  shorty.App.store.save();
  await shorty.App.account.flushNow();
  await wait(50);

  ok('истёкший ключ обновляется молча', server.refreshCount > before,
    'обновлений: ' + (server.refreshCount - before));
  ok('запрос после обновления доходит',
    server.state.households[shorty.App.account.household.id].state.settings.budget === 7777);
  server.tokenTtl = 3600;

  // ─────────────────────────────────────────── нет связи

  section('Пропала связь');

  const offline = device(origin, 'Без сети');
  await offline.App.account.signUp('offline@example.com', 'пароль123');
  const offlineHh = offline.App.account.household.id;

  offline.fetch = () => Promise.reject(new Error('сеть недоступна'));
  offline.App.store.get().settings.budget = 31000;
  offline.App.store.save();
  const res = await offline.App.account.push(false);

  ok('без связи приложение не падает', !!(res && res.offline));
  ok('правка сохранена локально', offline.App.store.get().settings.budget === 31000);
  ok('состояние показывает, что не сохранено', offline.App.account.status().pending);

  offline.fetch = (i, init) => fetch(i, init);
  await offline.App.account.flushNow();
  await wait(50);
  ok('связь вернулась — правка уехала',
    server.state.households[offlineHh].state.settings.budget === 31000,
    'на сервере ' + server.state.households[offlineHh].state.settings.budget + ' ₽');

  // ─────────────────────────────────────────── чужое хозяйство

  section('Чужое хозяйство недоступно');

  const stranger = device(origin, 'Посторонний');
  await stranger.App.account.signUp('stranger@example.com', 'пароль123');

  const peek = await stranger.App.cloud.fetchHousehold(hh1.id);
  ok('чужое хозяйство не читается по идентификатору', peek === null,
    'сервер не отдал ни строки');

  const write = await stranger.App.cloud.saveState(hh1.id, { взломано: true }, 0);
  ok('чужое хозяйство не перезаписывается', !write.ok);
  ok('чужие данные не пострадали',
    !server.state.households[hh1.id].state['взломано'],
    'состояние на месте');

  try {
    await stranger.App.cloud.joinHousehold('НЕВЕРНЫЙ');
    ok('неверный код приглашения отклоняется', false, 'пустил');
  } catch (e) {
    ok('неверный код приглашения отклоняется', /кода/.test(e.message) || /не найден/.test(e.message), e.message);
  }

  // ─────────────────────────────────────────── итог

  server.close();
  console.log('\n' + '─'.repeat(64));
  if (failures) {
    console.log('  ПРОВАЛЕНО: ' + failures);
    process.exit(1);
  }
  console.log('  Облачный слой проверен целиком.');
})().catch(function (err) {
  console.error('\n  ТЕСТ УПАЛ:', err && err.stack || err);
  process.exit(1);
});
