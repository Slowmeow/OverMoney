/* Разговор с Supabase напрямую, запросами.
 *
 * Официальную библиотеку тянуть не стали, и это осознанно. Она грузится
 * с чужого сервера — а у приложения ноль внешних адресов, на этом держатся
 * и правила загрузки ресурсов, и сборка версии для телефона в один файл.
 * Ради удобства пришлось бы разменять всё это. Нужного от Supabase здесь
 * немного: вход, обновление ключа доступа и несколько запросов к данным.
 *
 * Всё общение проходит через request(), и там же живёт единственная хитрость,
 * которая иначе расползлась бы по всему коду: ключ доступа живёт час,
 * а приложение открыто дольше. Поэтому истёкший ключ обновляется на месте,
 * и запрос повторяется — вызывающий об этом не знает и знать не должен.
 */
(function () {
  'use strict';

  const C = () => window.App.config;
  const SESSION_KEY = 'spendings.session';

  let session = null;          // { access_token, refresh_token, expires_at, user }
  let refreshing = null;       // общий промис обновления: параллельные запросы ждут один

  // ---------------------------------------------------------------- сессия

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      session = raw ? JSON.parse(raw) : null;
    } catch (e) {
      session = null;
    }
    return session;
  }

  function saveSession(next) {
    session = next;
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* без хранилища вход проживёт до закрытия вкладки */ }
  }

  function current() {
    if (session === null) loadSession();
    return session;
  }

  function user() {
    const s = current();
    return s && s.user ? s.user : null;
  }

  function signedIn() {
    return !!user();
  }

  /* Ключ считаем истёкшим за минуту до срока: запрос, отправленный
     в последнюю секунду жизни ключа, доедет уже просроченным. */
  function expired(s) {
    return !s || !s.expires_at || (s.expires_at * 1000 - 60000) < Date.now();
  }

  function adopt(data) {
    if (!data || !data.access_token) throw new Error('сервер не прислал ключ доступа');
    saveSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user || (session && session.user) || null
    });
    return session;
  }

  // ---------------------------------------------------------------- запросы

  function headers(extra) {
    const h = Object.assign({
      'apikey': C().anonKey,
      'Content-Type': 'application/json'
    }, extra || {});
    const s = current();
    if (s && s.access_token) h['Authorization'] = 'Bearer ' + s.access_token;
    return h;
  }

  /* Понятное сообщение вместо кода ошибки: человеку про 400 знать нечего. */
  function describe(status, body) {
    const msg = (body && (body.msg || body.message || body.error_description ||
      body.error || body.hint)) || '';
    const low = String(msg).toLowerCase();

    if (low.indexOf('invalid login') !== -1) return 'Неверная почта или пароль';
    if (low.indexOf('already registered') !== -1) return 'На эту почту уже есть аккаунт';
    if (low.indexOf('email not confirmed') !== -1) return 'Почта не подтверждена — проверьте письмо';
    if (low.indexOf('password should be') !== -1) return 'Пароль слишком короткий: нужно минимум 6 знаков';
    if (low.indexOf('код не найден') !== -1) return 'Такого кода приглашения нет';
    if (low.indexOf('не ваше хозяйство') !== -1) return 'Это хозяйство не ваше';
    if (low.indexOf('rate limit') !== -1 || status === 429) return 'Слишком много попыток — подождите минуту';
    if (status === 401 || status === 403) return 'Нужно войти заново';
    if (status >= 500) return 'Сервер не отвечает — попробуйте позже';
    return msg || ('Ошибка связи (' + status + ')');
  }

  function parse(res) {
    return res.text().then(function (text) {
      let body = null;
      if (text) { try { body = JSON.parse(text); } catch (e) { body = { message: text }; } }
      if (!res.ok) {
        const err = new Error(describe(res.status, body));
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    });
  }

  function raw(path, options) {
    if (!C().configured()) return Promise.reject(new Error('Облако не настроено'));
    return fetch(C().url + path, options).then(parse);
  }

  /* Обновление ключа доступа. Параллельные запросы, наткнувшиеся на истёкший
     ключ, ждут одно обновление, а не устраивают наперегонки несколько —
     сервер на это отвечает отзывом ключа обновления, и человека выкидывает. */
  function refresh() {
    const s = current();
    if (!s || !s.refresh_token) return Promise.reject(new Error('Нужно войти заново'));
    if (refreshing) return refreshing;

    refreshing = raw('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': C().anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (data) {
      refreshing = null;
      return adopt(data);
    }).catch(function (err) {
      refreshing = null;
      saveSession(null);            // ключ обновления мёртв — вход придётся повторить
      throw err;
    });

    return refreshing;
  }

  /* Запрос от имени вошедшего. Истёкший ключ обновляется молча. */
  function request(path, options) {
    options = options || {};
    const s = current();
    const go = () => raw(path, Object.assign({}, options, { headers: headers(options.headers) }));

    if (s && expired(s)) return refresh().then(go);
    return go().catch(function (err) {
      // Ключ мог протухнуть между проверкой и ответом сервера — тогда
      // одна попытка обновиться и повторить, но ровно одна.
      if (err.status === 401 && s && s.refresh_token) return refresh().then(go);
      throw err;
    });
  }

  // ---------------------------------------------------------------- вход

  function signUp(email, password) {
    return raw('/auth/v1/signup', {
      method: 'POST',
      headers: { 'apikey': C().anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email).trim(), password: password })
    }).then(function (data) {
      // Если в проекте включено подтверждение почты, ключа здесь не будет:
      // сначала письмо, вход потом. Это не ошибка, и говорить надо разное.
      if (!data || !data.access_token) return { needsConfirmation: true, user: data && data.user };
      adopt(data);
      return { needsConfirmation: false, user: data.user };
    });
  }

  function signIn(email, password) {
    return raw('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': C().anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email).trim(), password: password })
    }).then(function (data) {
      adopt(data);
      return data.user;
    });
  }

  function signOut() {
    const s = current();
    saveSession(null);
    if (!s || !s.access_token) return Promise.resolve();
    // Отозвать ключ на сервере — вежливость, а не необходимость: локально
    // мы его уже забыли, и неудача здесь ничего не меняет.
    return raw('/auth/v1/logout', {
      method: 'POST',
      headers: { 'apikey': C().anonKey, 'Authorization': 'Bearer ' + s.access_token }
    }).catch(() => {});
  }

  function resetPassword(email) {
    return raw('/auth/v1/recover', {
      method: 'POST',
      headers: { 'apikey': C().anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email).trim() })
    });
  }

  function changePassword(password) {
    return request('/auth/v1/user', {
      method: 'PUT',
      body: JSON.stringify({ password: password })
    });
  }

  // ---------------------------------------------------------------- данные

  function rpc(name, args) {
    return request('/rest/v1/rpc/' + name, {
      method: 'POST',
      body: JSON.stringify(args || {})
    });
  }

  function myHouseholds() {
    return rpc('my_households').then(rows => rows || []);
  }

  function createHousehold(name, state) {
    return rpc('create_household', { household_name: name || null, initial_state: state || null });
  }

  function joinHousehold(code) {
    return rpc('join_household', { code: String(code || '').trim().toUpperCase() });
  }

  function rotateInvite(id) {
    return rpc('rotate_invite_code', { hid: id });
  }

  function householdPeople(id) {
    return rpc('household_people', { hid: id }).then(rows => rows || []);
  }

  function leaveHousehold(id) {
    const u = user();
    if (!u) return Promise.reject(new Error('Нужно войти'));
    return request('/rest/v1/household_members?household_id=eq.' + encodeURIComponent(id) +
      '&user_id=eq.' + encodeURIComponent(u.id), { method: 'DELETE' });
  }

  function fetchHousehold(id) {
    return request('/rest/v1/households?id=eq.' + encodeURIComponent(id) + '&select=*', {
      method: 'GET'
    }).then(rows => (rows && rows[0]) || null);
  }

  /* Записать состояние, но только если с тех пор его никто не менял.
   *
   * Условие rev=eq.<ожидаемый> — это и есть защита от затирания чужой работы:
   * если другое устройство успело записаться раньше, номер версии уже другой,
   * под условие не попадает ни одна строка, и сервер возвращает пустой список.
   * Тогда отдаём наверх признак расхождения, а решает человек. */
  function saveState(id, state, baseRev) {
    return request('/rest/v1/households?id=eq.' + encodeURIComponent(id) +
      '&rev=eq.' + encodeURIComponent(baseRev) + '&select=*', {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ state: state })
    }).then(function (rows) {
      if (rows && rows.length) return { ok: true, row: rows[0] };
      return fetchHousehold(id).then(row => ({ ok: false, conflict: true, row: row }));
    });
  }

  window.App = window.App || {};
  window.App.cloud = {
    signUp, signIn, signOut, resetPassword, changePassword,
    user, signedIn, current, refresh,
    myHouseholds, createHousehold, joinHousehold, leaveHousehold,
    rotateInvite, householdPeople, fetchHousehold, saveState,
    available: () => C().configured()
  };
})();
