/* Общая база между телефоном и компьютером.
 *
 * Порядок намеренно «сначала локально»: приложение всегда читает и пишет
 * в браузер, поэтому открывается мгновенно и не ломается в магазине, где связи
 * нет. Сервер подтягивается следом и, если доступен, становится общей правдой
 * для обоих устройств.
 *
 * Чужие правки не затираются молча: у базы есть номер версии, и если её успели
 * изменить с другого устройства, сервер возвращает конфликт, а решение
 * принимает человек.
 */
(function () {
  'use strict';

  const URL = 'api/state';
  const PUSH_DELAY = 700;      // мс тишины перед отправкой — не слать запрос на каждое нажатие

  let available = false;       // отвечает ли сервер
  let baseRev = null;          // версия, от которой отталкиваемся
  let pushTimer = null;
  let pending = false;         // есть неотправленные изменения
  let conflict = false;
  const listeners = [];

  function status() {
    return { available: available, pending: pending, conflict: conflict, rev: baseRev };
  }

  function notify() {
    listeners.forEach(fn => { try { fn(status()); } catch (e) { console.warn(e); } });
  }

  function onChange(fn) { listeners.push(fn); }

  function setAvailable(value) {
    if (available === value) return;
    available = value;
    notify();
  }

  function request(method, body) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('нет fetch'));
    return fetch(URL, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
  }

  /* Забрать общую базу. Отдаёт состояние, только если на сервере есть что-то,
     чего мы ещё не видели. */
  function pull() {
    return request('GET').then(function (res) {
      if (!res.ok) throw new Error('сервер ответил ' + res.status);
      return res.json();
    }).then(function (data) {
      setAvailable(true);
      if (!data || !data.state) {
        // База пуста — первое устройство наполнит её своим состоянием.
        baseRev = data ? data.rev : 0;
        return null;
      }
      if (baseRev !== null && data.rev === baseRev) return null;   // ничего не менялось
      baseRev = data.rev;
      return data.state;
    }).catch(function () {
      setAvailable(false);
      return null;
    });
  }

  /* Отправить состояние пачкой, с задержкой. */
  function push(getState) {
    pending = true;
    notify();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush(getState); }, PUSH_DELAY);
  }

  function flush(getState, force) {
    return request('PUT', { baseRev: baseRev, state: getState(), force: !!force })
      .then(function (res) {
        if (res.status === 409) {
          // На сервере уже чужая версия. Молча затирать нельзя.
          conflict = true;
          pending = true;
          setAvailable(true);
          notify();
          return res.json().then(theirs => ({ conflict: true, state: theirs.state, rev: theirs.rev }));
        }
        if (!res.ok) throw new Error('сервер ответил ' + res.status);
        return res.json().then(function (data) {
          baseRev = data.rev;
          pending = false;
          conflict = false;
          setAvailable(true);
          notify();
          return { conflict: false };
        });
      })
      .catch(function () {
        // Связи нет — изменения остаются в браузере и уедут при следующей попытке.
        setAvailable(false);
        return { offline: true };
      });
  }

  /* Записать своё поверх серверного — одна из двух развязок конфликта. */
  function overwrite(getState) { return flush(getState, true); }

  /* Принять серверное как своё — вторая развязка. */
  function acceptRemote(rev) {
    baseRev = rev;
    conflict = false;
    pending = false;
    notify();
  }

  window.App = window.App || {};
  window.App.sync = { pull, push, flush, overwrite, acceptRemote, status, onChange };
})();
