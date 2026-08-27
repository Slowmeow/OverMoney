/* Аккаунт, хозяйство и синхронизация состояния.
 *
 * Здесь сходятся три вещи, которые по отдельности просты, а вместе дают
 * почти все ошибки такого рода приложений: кто вошёл, чьи данные показывать
 * и что делать, когда два устройства правят их одновременно.
 *
 * Порядок намеренно «сначала локально». Приложение читает и пишет в браузер,
 * поэтому открывается мгновенно и работает в магазине, где связи нет. Облако
 * подтягивается следом и, если доступно, становится общей правдой.
 *
 * Три режима, и приложение обязано вести себя понятно в каждом:
 *   нет настроек облака — всё локально, аккаунтов нет вовсе, как раньше;
 *   облако есть, но не вошли — гостевой режим, данные только в этом браузере;
 *   вошли — данные принадлежат хозяйству и живут в облаке.
 */
(function () {
  'use strict';

  const CLOUD = () => window.App.cloud;
  const STORE = () => window.App.store;

  const HOUSEHOLD_KEY = 'spendings.household';
  const GUEST_KEY = 'spendings.guest';
  const PUSH_DELAY = 900;        // мс тишины перед отправкой

  let household = null;          // { id, name, invite_code, rev }
  let pushTimer = null;
  let pending = false;
  let busy = false;
  let conflict = false;
  let lastError = '';
  const listeners = [];

  // ---------------------------------------------------------------- состояние слоя

  function status() {
    return {
      configured: CLOUD().available(),
      signedIn: CLOUD().signedIn(),
      guest: isGuest(),
      email: (CLOUD().user() || {}).email || '',
      household: household,
      pending: pending,
      conflict: conflict,
      error: lastError
    };
  }

  function onChange(fn) { listeners.push(fn); }

  function notify() {
    const s = status();
    listeners.forEach(fn => { try { fn(s); } catch (e) { console.warn(e); } });
  }

  /* Гостевой режим — сознательный выбор «посмотреть без аккаунта».
     Он отличается от «ещё не вошёл» тем, что человек его выбрал, и приложение
     не имеет права снова показывать ему экран входа при каждом запуске. */
  function isGuest() {
    try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; }
  }

  function setGuest(on) {
    try {
      if (on) localStorage.setItem(GUEST_KEY, '1');
      else localStorage.removeItem(GUEST_KEY);
    } catch (e) { /* без хранилища режим проживёт до перезагрузки */ }
    notify();
  }

  function rememberHousehold(row) {
    household = row ? {
      id: row.id, name: row.name, invite_code: row.invite_code, rev: row.rev
    } : null;
    try {
      if (household) localStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(household));
      else localStorage.removeItem(HOUSEHOLD_KEY);
    } catch (e) { /* переживём */ }
    notify();
    return household;
  }

  function loadRememberedHousehold() {
    try {
      const raw = localStorage.getItem(HOUSEHOLD_KEY);
      household = raw ? JSON.parse(raw) : null;
    } catch (e) { household = null; }
    return household;
  }

  // ---------------------------------------------------------------- вход

  /* Нужно ли показать экран входа вместо приложения.
     Показываем ровно тогда, когда облако настроено, человек не вошёл
     и гостем быть не соглашался. */
  function needsAuth() {
    return CLOUD().available() && !CLOUD().signedIn() && !isGuest();
  }

  function signIn(email, password) {
    return CLOUD().signIn(email, password).then(function (user) {
      setGuest(false);
      return afterSignIn().then(() => user);
    });
  }

  function signUp(email, password) {
    return CLOUD().signUp(email, password).then(function (result) {
      if (result.needsConfirmation) return result;
      setGuest(false);
      return afterSignIn().then(() => result);
    });
  }

  /* Выход обязан стереть данные из этого браузера.
   *
   * Иначе следующий человек, открывший приложение на том же устройстве,
   * увидит чужие цены, кладовую и профили — ровно то, чего вход и должен
   * не допускать. Данные при этом не теряются: они остались в облаке
   * и вернутся при следующем входе. */
  function signOut() {
    return flushNow().catch(() => {}).then(function () {
      return CLOUD().signOut();
    }).then(function () {
      rememberHousehold(null);
      setGuest(false);
      conflict = false;
      STORE().reset({ local: true });
      notify();
    });
  }

  /* Что происходит сразу после успешного входа.
   *
   * Развилка здесь одна, и она важна: если человек до входа работал гостем
   * и что-то успел завести, эти данные надо забрать с собой, а не потерять.
   * Отличаем по признаку «в хозяйстве ещё нет состояния» — тогда местное
   * и становится первым состоянием хозяйства. */
  function afterSignIn() {
    return CLOUD().myHouseholds().then(function (rows) {
      if (rows.length) {
        rememberHousehold(rows[0]);
        return pull({ adoptRemote: true });
      }
      // Хозяйства нет — заводим, и семенем кладём то, что человек уже наработал.
      const local = STORE().get();
      return CLOUD().createHousehold(null, local).then(function (row) {
        rememberHousehold(row);
        setGuest(false);
        return household;
      });
    });
  }

  // ---------------------------------------------------------------- обмен

  /* Забрать состояние хозяйства.
   *
   * adoptRemote означает «мы только что вошли, местное состояние не наше» —
   * тогда облачное принимается без разговоров. В обычной же работе, когда
   * человек уже что-то правил, молча затирать его правки нельзя. */
  function pull(opts) {
    opts = opts || {};
    if (!household) return Promise.resolve(null);

    return CLOUD().fetchHousehold(household.id).then(function (row) {
      if (!row) return null;
      const known = household.rev;
      rememberHousehold(row);
      lastError = '';

      if (!row.state) {
        // Хозяйство пустое — наполняем его тем, что есть здесь.
        return push(true).then(() => null);
      }
      if (!opts.adoptRemote && row.rev === known) return null;   // ничего не менялось

      STORE().adopt(row.state, { silent: true });
      return row.state;
    }).catch(function (err) {
      lastError = err.message;
      notify();
      return null;
    });
  }

  /* Отправить состояние пачкой, после паузы. Пауза нужна, чтобы правка цены
     не превращалась в запрос на каждое нажатие клавиши. */
  function schedulePush() {
    if (!household || !CLOUD().signedIn()) return;
    pending = true;
    notify();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { push(false); }, PUSH_DELAY);
  }

  function push(force) {
    if (!household || !CLOUD().signedIn()) return Promise.resolve();
    if (busy) { schedulePush(); return Promise.resolve(); }

    busy = true;
    const state = STORE().get();
    return CLOUD().saveState(household.id, state, household.rev).then(function (res) {
      busy = false;
      if (res.ok) {
        rememberHousehold(res.row);
        pending = false;
        conflict = false;
        lastError = '';
        notify();
        return { ok: true };
      }
      // Кто-то записался раньше. Молча затирать чужую работу нельзя.
      if (force && res.row) {
        return forceOverwrite(res.row.rev);
      }
      conflict = true;
      pending = true;
      notify();
      return { conflict: true, remote: res.row };
    }).catch(function (err) {
      busy = false;
      pending = true;
      lastError = err.message;
      notify();
      return { offline: true };
    });
  }

  function forceOverwrite(rev) {
    if (!household) return Promise.resolve({ ok: false });
    return CLOUD().saveState(household.id, STORE().get(), rev).then(function (res) {
      if (res.ok) {
        rememberHousehold(res.row);
        pending = false; conflict = false;
        notify();
        return { ok: true };
      }
      return { conflict: true, remote: res.row };
    });
  }

  function flushNow() {
    clearTimeout(pushTimer);
    if (!pending || !household || !CLOUD().signedIn()) return Promise.resolve();
    return push(false);
  }

  /* Принять облачную версию, отказавшись от своей. */
  function acceptRemote(row) {
    if (!row) return Promise.resolve();
    rememberHousehold(row);
    if (row.state) STORE().adopt(row.state, { silent: true });
    conflict = false;
    pending = false;
    notify();
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- хозяйство

  function people() {
    if (!household) return Promise.resolve([]);
    return CLOUD().householdPeople(household.id);
  }

  /* Присоединиться к чужому хозяйству, забрав свои данные с собой.
   *
   * Порядок здесь единственно верный и стоил бы дорого, ошибись мы в нём:
   * сначала вступаем, потом читаем чужое состояние, сливаем со своим
   * и записываем результат. Записать до вступления нельзя — правила доступа
   * не пустят; слить до чтения нечего.
   *
   * Если в чужом хозяйстве состояния ещё нет, слияние вырождается в перенос
   * своего — и это правильно, а не особый случай. */
  function joinByCode(code) {
    const mine = JSON.parse(JSON.stringify(STORE().get()));
    return CLOUD().joinHousehold(code).then(function (row) {
      rememberHousehold(row);
      const merged = window.App.merge.mergeStates(row.state, mine);
      return CLOUD().saveState(row.id, merged, row.rev).then(function (res) {
        const saved = res.row || row;
        rememberHousehold(saved);
        STORE().adopt(merged, { silent: true });
        return { household: saved, merged: merged };
      });
    });
  }

  /* Что изменится при вступлении — до того, как человек согласится. */
  function previewJoin(code) {
    const mine = STORE().get();
    return CLOUD().joinHousehold(code).then(function (row) {
      // Вступление уже произошло: узнать состав чужого хозяйства иначе нельзя,
      // правила доступа не дают читать то, где ты не состоишь. Выйти обратно
      // можно одной кнопкой, поэтому цена ошибки здесь невелика.
      rememberHousehold(row);
      return {
        household: row,
        changes: window.App.merge.describeMerge(row.state, mine),
        hasState: !!row.state
      };
    });
  }

  function leave() {
    if (!household) return Promise.resolve();
    const id = household.id;
    return CLOUD().leaveHousehold(id).then(function () {
      rememberHousehold(null);
      // Своё хозяйство заводится заново, с текущими данными: человек уходит
      // не в пустоту, а к тому, чем пользовался.
      return CLOUD().createHousehold(null, STORE().get()).then(rememberHousehold);
    });
  }

  function rotateInvite() {
    if (!household) return Promise.resolve('');
    return CLOUD().rotateInvite(household.id).then(function (code) {
      household.invite_code = code;
      rememberHousehold(household);
      return code;
    });
  }

  function rename(name) {
    if (!household) return Promise.resolve();
    return window.App.cloud.fetchHousehold(household.id).then(function () {
      return fetch(window.App.config.url + '/rest/v1/households?id=eq.' + household.id, {
        method: 'PATCH',
        headers: {
          'apikey': window.App.config.anonKey,
          'Authorization': 'Bearer ' + CLOUD().current().access_token,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ name: name })
      }).then(r => r.json()).then(rows => rememberHousehold((rows && rows[0]) || household));
    });
  }

  // ---------------------------------------------------------------- запуск

  function init() {
    loadRememberedHousehold();
    if (!CLOUD().available() || !CLOUD().signedIn()) { notify(); return Promise.resolve(); }

    return CLOUD().myHouseholds().then(function (rows) {
      if (!rows.length) return afterSignIn();
      // Держимся того хозяйства, в котором работали, если человек всё ещё в нём.
      const keep = household && rows.find(r => r.id === household.id);
      rememberHousehold(keep || rows[0]);
      return pull({ adoptRemote: true });
    }).catch(function (err) {
      lastError = err.message;
      notify();
    });
  }

  window.App = window.App || {};
  window.App.account = {
    init, status, onChange, needsAuth,
    signIn, signUp, signOut, setGuest, isGuest,
    pull, push, schedulePush, flushNow, acceptRemote, forceOverwrite,
    joinByCode, previewJoin, leave, rotateInvite, rename, people,
    get household() { return household; }
  };
})();
